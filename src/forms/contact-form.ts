/** Static contact-form backends — no site database. */

export type ContactFormProvider = "web3forms" | "formsubmit";

export interface ContactFormConfig {
  provider: ContactFormProvider;
  action: string;
  email: string;
  accessKey?: string;
  redirectPath: string;
}

export const QUOTE_ESTIMATE_STORAGE_KEY = "wg-quote-estimate";

export function businessEmailFromName(businessName: string): string {
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return `hello@${slug || "studio"}.com`;
}

export function resolveContactFormConfig(
  email: string,
  options?: { accessKey?: string; redirectPath?: string }
): ContactFormConfig {
  const redirectPath = options?.redirectPath ?? "/thank-you";
  const accessKey = (options?.accessKey ?? process.env.WEB3FORMS_ACCESS_KEY ?? "").trim();
  if (accessKey) {
    return {
      provider: "web3forms",
      action: "https://api.web3forms.com/submit",
      email,
      accessKey,
      redirectPath,
    };
  }
  return {
    provider: "formsubmit",
    action: `https://formsubmit.co/${encodeURIComponent(email)}`,
    email,
    redirectPath,
  };
}

export function stampContactFormProps(
  props: Record<string, unknown>,
  businessName: string,
  displayEmail?: string
): Record<string, unknown> {
  const email =
    (typeof displayEmail === "string" && displayEmail.includes("@")
      ? displayEmail
      : typeof props.email === "string" && props.email.includes("@")
        ? props.email
        : businessEmailFromName(businessName));
  const config = resolveContactFormConfig(email);
  return {
    ...props,
    email,
    formProvider: config.provider,
    formAccessKey: config.accessKey,
    formEmail: config.email,
    formAction: config.action,
    redirectPath: config.redirectPath,
  };
}
