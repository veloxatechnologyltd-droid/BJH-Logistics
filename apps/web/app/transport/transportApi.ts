import { authenticatedFetch } from "../auth/authenticatedFetch";

export type Driver = {
  id: string;
  name: string;
  phone: string;
  deactivatedAt: string | null;
};

export type Vehicle = {
  id: string;
  registration: string;
  description: string | null;
  insuranceStartOn: string | null;
  insuranceEndOn: string | null;
  dvlaExpiresOn: string | null;
  serviceEveryMonths: number | null;
  lastServicedOn: string | null;
  nextServiceOn: string | null;
  deactivatedAt: string | null;
};

/** What the vehicle form sends; empty text means no date. */
export type VehicleInput = {
  registration: string;
  description?: string;
  insuranceStartOn?: string;
  insuranceEndOn?: string;
  dvlaExpiresOn?: string;
  serviceEveryMonths: number | null;
  lastServicedOn?: string;
};

export type Delivery = {
  id: string;
  waybillNumber: string;
  driverName: string;
  driverPhone: string;
  vehicleRegistration: string;
  cargoDescription: string;
  packages: number | null;
  grossWeightKg: number | null;
  pickupLocation: string | null;
  deliveryAddress: string;
  dispatchedAt: string;
  status: "dispatched" | "delivered";
  receiverName: string | null;
  receiverPhone: string | null;
  deliveredAt: string | null;
  damageNotes: string | null;
  podDocumentId: string | null;
};

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await authenticatedFetch(`${apiBaseUrl}/v1${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(failure?.message)
      ? failure.message.join(", ")
      : failure?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

export async function fetchWaybillPdf(
  jobId: string,
  deliveryId: string,
): Promise<Blob> {
  const response = await authenticatedFetch(
    `${apiBaseUrl}/v1/jobs/${encodeURIComponent(jobId)}/deliveries/${encodeURIComponent(deliveryId)}/pdf`,
  );
  if (!response.ok) throw new Error("The waybill could not be created");
  return response.blob();
}

export const listDrivers = () => send<Driver[]>("/drivers", "GET");
export const addDriver = (input: { name: string; phone: string }) =>
  send<Driver>("/drivers", "POST", input);
export const setDriverActive = (id: string, active: boolean) =>
  send<Driver>(`/drivers/${encodeURIComponent(id)}/active`, "POST", {
    active,
  });
export const listVehicles = () => send<Vehicle[]>("/vehicles", "GET");
export const addVehicle = (input: VehicleInput) =>
  send<Vehicle>("/vehicles", "POST", input);
export const updateVehicle = (id: string, input: VehicleInput) =>
  send<Vehicle>(`/vehicles/${encodeURIComponent(id)}`, "PUT", input);
export const setVehicleActive = (id: string, active: boolean) =>
  send<Vehicle>(`/vehicles/${encodeURIComponent(id)}/active`, "POST", {
    active,
  });

export const listDeliveries = (jobId: string) =>
  send<Delivery[]>(`/jobs/${encodeURIComponent(jobId)}/deliveries`, "GET");
export const dispatchDelivery = (
  jobId: string,
  input: {
    driverId?: string;
    driverName?: string;
    driverPhone?: string;
    vehicleId?: string;
    vehicleRegistration?: string;
    cargoDescription: string;
    packages?: number;
    grossWeightKg?: number;
    pickupLocation?: string;
    deliveryAddress: string;
  },
) =>
  send<Delivery>(
    `/jobs/${encodeURIComponent(jobId)}/deliveries`,
    "POST",
    input,
  );
export const recordProof = (
  jobId: string,
  deliveryId: string,
  input: {
    receiverName: string;
    receiverPhone?: string;
    deliveredAt?: string;
    damageNotes?: string;
    podDocumentId?: string;
  },
) =>
  send<Delivery>(
    `/jobs/${encodeURIComponent(jobId)}/deliveries/${encodeURIComponent(deliveryId)}/proof`,
    "POST",
    input,
  );
