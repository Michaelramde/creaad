/**
 * Jeu étiqueté — 24 annonces RÉELLES (Meta Ad Library, Côte d'Ivoire).
 *
 * Étiquetées à la main le 25/10/2026, une par une, en lisant l'annonce
 * entière et en se demandant : « quel est l'angle dominant ? ».
 *
 * Ce fichier existe parce qu'aucune mesure de la qualité de classification
 * n'existait. Sans lui, on ne pouvait pas savoir si la matrice de saturation
 * décrivait le marché ou le bruit du classifieur.
 *
 * Convention : `non-classe` est un **aveu**, pas une faute — c'est le bon
 * étiquetage d'une annonce de distribution qui ne vend aucun angle.
 */
export interface LabelledHook {
  id: string;
  hook: string;
  /** Angle réellement porté par l'annonce (jugement humain). */
  family: string;
}

export const LABELLED_HOOKS: LabelledHook[] = [
  {
    id: "1",
    hook: "Paiement à la livraison. Un porte-cartes magnétique blanc avec support pliable. Nécessite un téléphone ou une coque compatible avec la fixation magnétique.",
    family: "garantie",
  },
  {
    id: "2",
    hook: "J'ai vidé mes comptes pour sauver Sylvain, un serpent de rang S que tout le monde avait jeté. Je l'ai soigné avec mon propre sang. Il m'a méprisée, puis abandonnée quatre-vingt-dix-neuf fois pour une Élite. La dernière f",
    family: "temoignage",
  },
  {
    id: "3",
    hook: "🛵🛵🛵Passez vos commandes sur WhatsApp 54 80 60 34 ++ Devenez revendeur indépendant de Arvea🇮🇪 🇧🇫 et bénéficiez d'une réduction de 20%, 30% et 70% Pour plus d'informations, contactez-nous au 0554806034 Ou visiter no",
    family: "prix-offre",
  },
  {
    id: "4",
    hook: "🥰 Voulez-vous expérimentez la véritable qualité de Smart Watch ULTRA ? Recevez des notifications en temps réel avec notre Smart Watch connectée et restez connecté où que vous soyez et à tout moment ! 🥰 N'B: 1 Montre, 1",
    family: "demonstration",
  },
  {
    id: "5",
    hook: "Bonjour souhaitez vous faire un achat ou prendre rdv pour un soin ? Ecrivez nous sur whatsapp +2250504908634 ou appel direct +2250748878769.",
    family: "non-classe",
  },
  {
    id: "6",
    hook: "Arrivage encore ma caviar🥰🥰 Que des pepites chez mamou🥰 Vient te ravitailler mon client🥰 Tel/what:0503232020",
    family: "nouveaute",
  },
  {
    id: "7",
    hook: "✨ 𝐋𝐄 𝐆𝐄𝐒𝐓𝐄 𝐁𝐄𝐀𝐔𝐓𝐄́ 𝐐𝐔𝐈 𝐂𝐇𝐀𝐍𝐆𝐄 𝐓𝐎𝐔𝐓 ! ✨ ✅ 𝐏𝐑𝐈𝐗 : 𝟒.𝟗𝟗𝟗 𝐅𝐂𝐅𝐀 ✅ 𝐕𝐨𝐭𝐫𝐞 𝐩𝐞𝐚𝐮 𝐦𝐚𝐧𝐪𝐮𝐞 𝐝’𝐞́𝐜𝐥𝐚𝐭, 𝐩𝐚𝐫𝐚𝐢̂𝐭 𝐟𝐚𝐭𝐢𝐠𝐮𝐞́𝐞 𝐨𝐮 𝐢𝐫𝐫𝐞́𝐠𝐮𝐥𝐢𝐞̀𝐫𝐞 ? 😩 𝐃𝐞́",
    family: "prix-offre",
  },
  {
    id: "8",
    hook: "Je me rends compte que les bons gestes d’application, ça fait vraiment toute la différence ! En ce moment, j’utilise la Crème de soin 2 en 1 et l’Élixir de la gamme Garnier Ultra Doux Avocat & Karité. Le combo parfait",
    family: "temoignage",
  },
  {
    id: "9",
    hook: "🎒🛍️ BUSINESS ELITE – Le sac qui parle de ton niveau ! Tu veux un sac classe, solide et ultra-pratique pour le travail, les études ou les déplacements ? 👉 Ce sac est fait pour toi 💼✨ ✅ Design élégant & professionnel ✅",
    family: "identite",
  },
  {
    id: "10",
    hook: "⭕️ \"SAVON TOMATO \" ⭕️ Nouveau Format 🟩RAJEUNISSANT 🟩HYDRATANT 🟩ANTI -TÂC.HES 🟩ANTI -BOU.TONS 🟩RÉTRÉCIT LES VER.GETURES 🟩FINI LES MASQUES DE GROSS.ESSE 🟩É.CLAIRCI DE MANIÈRE UNIFORME",
    family: "nouveaute",
  },
  {
    id: "11",
    hook: "🔥 GRANDE PROMO ! 🔥 ⌚ 1 montre achetée = 1 montre offerte 🎁 🎧 + 1 écouteur Bluetooth offert 💰 Le tout à seulement 15 000 FCFA ! 🚚 Livraison gratuite à Abidjan. Bouaké 📍 paiement à la livraison 📍 Yamoussoukro & Kor",
    family: "prix-offre",
  },
  {
    id: "12",
    hook: "Paiement à la livraison. Complétez votre routine capillaire avec cette huile de soin. Consultez sa composition et les conseils d'application sur la page produit.",
    family: "garantie",
  },
  {
    id: "13",
    hook: "🎧 LE MÉGA PACK DUO CONNECTÉ EST ENFIN LÀ CHEZ NOVO SHOP ! ⌚ ​🚨 ALERTE PROMO : Casque Premium + Montre Connectée + Accessoires ! 🚨 ​Pourquoi choisir entre un bon casque et une montre connectée quand vous pouvez avoir l",
    family: "nouveaute",
  },
  {
    id: "14",
    hook: "Urgent promotion sur 2 jours Montre CURREN FEMME en acier inoxydable 10 mille avec coffret d’origine NB : le sac est à 500F LIVRAISON À VOS FRAIS WHATSAPP : 0503382614",
    family: "urgence",
  },
  {
    id: "15",
    hook: "🌬️ Respirez la fraîcheur, partout et à petit prix ! Dites adieu à la chaleur avec le Mini Ventilateur Portable, votre allié indispensable pour rester au frais en toute circonstance. Conçu pour offrir un confort optima",
    family: "probleme-solution",
  },
  {
    id: "16",
    hook: "Urgent promotion sur 2 jours Montre CURREN FEMME en acier inoxydable 10 mille avec coffret d’origine NB : le sac est à 500F LIVRAISON À VOS FRAIS WHATSAPP : 0503382614",
    family: "urgence",
  },
  {
    id: "17",
    hook: "🥰 Êtes-vous fatiguer de Smart Watch qui ne sont pas de qualité. Découvrez la montre connectée intelligente qui va changer votre vie avec sa particularité et sa qualité supérieure. 🥰 N'B: 1 Montre, 1 Ecouteur, 1 Baffe,",
    family: "probleme-solution",
  },
  {
    id: "18",
    hook: "🌟 NOUVEAUTÉ PPUR VOUS ! 🔥 L'alliance parfaite de l'élégance et de la praticité ! Protégez votre Samsung Ultra avec style grâce à cette coque premium en finition silicone cousue ✅ Prix : 12.000f ✅ Couleur : noir",
    family: "nouveaute",
  },
  {
    id: "19",
    hook: "Envie de sentir bon toute la journée ? 🌸 Découvrez les essences RaDi Shop, disponibles pour homme et femme, avec des fragrances élégantes et raffinées. ✨ Une senteur qui vous ressemble. ✨ Plusieurs formats disponibles.",
    family: "probleme-solution",
  },
  {
    id: "20",
    hook: "Ton panier mode enfant est toujours là. Les stocks fondent, zo! Finalise ton achat sur Jumia avant qu'il soit trop tard.",
    family: "urgence",
  },
  {
    id: "21",
    hook: "HT26 PARIS disponible chez FLEUR DE FEMME a abidjan par whatsapp en cliquant sur wa.me/+2250141171545",
    family: "non-classe",
  },
  {
    id: "22",
    hook: "VOS MEILLEURS IPHONES !!! Importés USA Google play: https://play.google.com/store/apps/details?id=com.kanguroo.us App Store https://apps.apple.com/us/app/kanguroo/id6501969966 Magasin situé à Yopougon Maroc Anador, Ca",
    family: "non-classe",
  },
  {
    id: "23",
    hook: "✨ CHEVEUX BLANCS ? ON A LA SOLUTION ! ✨ NOIRESSENCE – Shampoing Noircissant à l’Huile d’Argan 👉 En seulement 10 à 15 minutes, retrouve des cheveux noirs, propres et élégants comme avant ✔ Couvre 100% des cheveux blan",
    family: "probleme-solution",
  },
  {
    id: "24",
    hook: "Tablette éducative enfant écran 7,8et10pouces avec ou sans puce disponible en stock neuf garantis S.A.V Livraison le même jour 1500frcs a Abidjan Whatsapp: 0707903480 pour plus d'informations Appel: 0707903480/01023433",
    family: "garantie",
  },
];
