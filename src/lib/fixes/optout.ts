export interface OptOutInput {
  name: string;
  email: string;
  broker: string;
  listingUrl: string;
  /** Labels only are needed; values are what the broker must remove. */
  fields: { label: string; value: string }[];
}

export interface OptOutDraft {
  subject: string;
  body: string;
}

/** Plain draft used when the model is unavailable. The user reviews and sends it themselves. */
export function templateDraft(i: OptOutInput): OptOutDraft {
  const items = i.fields.map((f) => `- ${f.label}: ${f.value}`).join("\n");
  return {
    subject: `Request to remove my personal information (${i.name})`,
    body: [
      `Hello ${i.broker} privacy team,`,
      "",
      "I am the person described by the listing below, and I am asking you to delete it and stop selling or sharing this information.",
      "",
      `Listing: ${i.listingUrl}`,
      "Information to remove:",
      items,
      "",
      "Please also suppress my record so it is not re-added from other data sources, and confirm by reply once it is done. If you need to verify my identity, reply to this email and tell me what you need.",
      "",
      "If you operate in a US state with a privacy law, this is also a request to delete under that law.",
      "",
      "Thank you,",
      i.name,
      i.email,
    ].join("\n"),
  };
}

export function mailtoHref(d: OptOutDraft, to = ""): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}
