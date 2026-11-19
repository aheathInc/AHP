/** Supplied Human Care artwork. The wordmark remains outlined, never retyped. */
export function BrandLogo() {
  return (
    <span className="ahp-brand-logo" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="ahp-logo-colour ahp-logo-horizontal"
        src="/brand/horizontal_full_colour.svg"
        alt=""
        width={180}
        height={50}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="ahp-logo-white ahp-logo-horizontal"
        src="/brand/horizontal_white.svg"
        alt=""
        width={180}
        height={50}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="ahp-logo-white ahp-logo-symbol"
        src="/brand/symbol_white.svg"
        alt=""
        width={40}
        height={40}
      />
    </span>
  );
}
