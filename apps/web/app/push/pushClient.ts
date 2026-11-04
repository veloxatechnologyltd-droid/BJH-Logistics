import { authenticatedFetch } from "../auth/authenticatedFetch";
import { uint8ArrayToUrlBase64, urlBase64ToUint8Array } from "./pushKey";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const pushUrl = `${apiBaseUrl}/v1/push`;

/**
 * Notifications that arrive with BJH closed (Evans, 2026-11-04): this browser
 * subscribes to the server's push service through the service worker in
 * `public/sw.js`, and tells the API, which then sends to it. Everything here is
 * the person's own choice, made on this device.
 */

/** Browsers without a service worker or the Push API (an iPhone not yet added to the Home Screen, for one). */
export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

async function subscriptionHere(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

/** The key browsers subscribe with; null when the server has no push set up. */
export async function pushKey(): Promise<string | null> {
  const response = await authenticatedFetch(`${pushUrl}/key`);
  if (!response.ok) return null;
  return ((await response.json()) as { publicKey: string | null }).publicKey;
}

/** True when this browser is allowed and subscribed. */
export async function pushIsOn(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    return (await subscriptionHere()) !== null;
  } catch {
    return false;
  }
}

async function tellServer(subscription: PushSubscription) {
  const response = await authenticatedFetch(`${pushUrl}/subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok)
    throw new Error("The server did not accept the subscription");
}

/**
 * Subscribes this browser and tells the API. Notification permission must
 * already be granted (ask from a click first). "unavailable" means the server
 * has no push keys yet.
 */
export async function turnOnPush(): Promise<
  "on" | "unavailable" | "unsupported"
> {
  if (!pushSupported()) return "unsupported";
  const key = await pushKey();
  if (!key) return "unavailable";
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // Keys changed on the server since this browser subscribed: start again.
  const old = subscription?.options.applicationServerKey;
  if (subscription && old && uint8ArrayToUrlBase64(old) !== key) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await tellServer(subscription);
  return "on";
}

/**
 * Tells the API about a subscription this browser already has, once per visit:
 * it keeps the server's copy current (browsers change them now and then), and
 * moves it to whoever is signed in now. It never asks anything.
 */
export async function refreshPush(): Promise<void> {
  try {
    if (!(await pushIsOn())) return;
    const subscription = await subscriptionHere();
    if (subscription) await tellServer(subscription);
  } catch {
    // Quiet: the next visit tries again.
  }
}

/**
 * Stops notifications on this browser: the API forgets it, then the browser
 * does. Used when someone signs out, so a shared computer does not keep
 * showing the last person's messages.
 */
export async function turnOffPush(): Promise<void> {
  try {
    if (!pushSupported()) return;
    const subscription = await subscriptionHere();
    if (!subscription) return;
    await authenticatedFetch(`${pushUrl}/subscriptions`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Signing out must never wait on this.
  }
}

/**
 * Closes the notifications of team conversations that are no longer unread:
 * the server's pushes stay on screen until read, and reading happens in the
 * app. Whatever is still unread is left showing.
 */
export async function closeReadTeamNotifications(unreadIds: Set<string>) {
  try {
    if (!pushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    for (const shown of (await registration?.getNotifications()) ?? []) {
      if (
        shown.tag.startsWith("team-chat:") &&
        !unreadIds.has(shown.tag.slice("team-chat:".length))
      ) {
        shown.close();
      }
    }
  } catch {
    // The notification simply stays until it is dismissed.
  }
}
