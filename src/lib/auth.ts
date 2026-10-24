import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Resend } from "resend";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

async function sendEmail(input: { to: string; subject: string; html: string }) {
  if (!resend) {
    // Pas de clé : on trace au lieu de bloquer le développement local.
    console.warn(`[email] RESEND_API_KEY absente — email non envoyé à ${input.to}`);
    return;
  }
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}

/**
 * Auth : email + mot de passe, vérification par email.
 * Aucun SMS — coût variable par utilisateur incompatible avec le modèle.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.APP_URL,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  emailAndPassword: {
    enabled: true,
    // Sans clé Resend, exiger la vérification rendrait l'app inutilisable :
    // on l'active par variable d'environnement, quand l'envoi est configuré.
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    minPasswordLength: 8,
  },
  emailVerification: {
    sendOnSignUp: env.REQUIRE_EMAIL_VERIFICATION,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Confirme ton compte Creaad",
        html: `<p>Bienvenue sur Creaad.</p><p><a href="${url}">Confirmer mon adresse email</a></p>`,
      });
    },
  },
  user: {
    additionalFields: {
      phone: { type: "string", required: false },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
