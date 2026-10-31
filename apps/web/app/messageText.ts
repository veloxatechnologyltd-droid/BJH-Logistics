/** Emailed requests are stored with Windows line breaks, which browsers draw as stray symbols. */
export function tidyMessage(message: string): string {
  return message.replace(/\r\n?/g, "\n").trim();
}
