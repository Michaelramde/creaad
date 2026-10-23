import { Inngest } from "inngest";

/**
 * Client Inngest — orchestrateur du pipeline (J1+).
 * Les étapes sont déclarées dans `src/lib/inngest/functions`.
 */
export const inngest = new Inngest({ id: "creaad" });
