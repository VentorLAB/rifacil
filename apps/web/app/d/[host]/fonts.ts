import { Anton, Caveat, Outfit } from "next/font/google";

// Fuentes del diseño rifas-hp. Exponen variables CSS que storefront.css mapea a
// --display / --script / --body. Scoped: se aplican poniendo las 3 classNames de
// variable en el contenedor raíz de la landing.
export const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});

export const caveat = Caveat({
  weight: ["600", "700"],
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
});

export const outfit = Outfit({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const storefrontFontVars = `${anton.variable} ${caveat.variable} ${outfit.variable}`;
