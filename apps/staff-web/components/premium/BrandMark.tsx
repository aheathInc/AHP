import type { SVGProps } from "react";
/** Original Human Care symbol, with supplied white artwork for dark surfaces. */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 100"
      width="32"
      height="32"
      aria-hidden="true"
      {...props}
    >
      <image
        className="ahp-logo-colour"
        href="/brand/symbol_full_colour.svg"
        width="100"
        height="100"
      />
      <image
        className="ahp-logo-white"
        href="/brand/symbol_white.svg"
        width="100"
        height="100"
      />
    </svg>
  );
}
