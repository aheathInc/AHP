"use client";

import { useState } from "react";
import { clinicalArtwork } from "@/lib/premium/artwork";
import { signIn, useSession } from "next-auth/react";
import { DisplayPreferences } from "@/components/premium/DisplayPreferences";
import { Icon } from "@/components/premium/Icon";
import { BrandLogo } from "@/components/premium/BrandLogo";
import { Button, Field, Notice, inputClass } from "@/components/ui";

export default function Login() {
  const { status: sessionStatus } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  async function staffSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (sessionStatus === "loading" || busy) return;
    setBusy(true);
    setError(null);
    setError(null);
    try {
      const res = await signIn("credentials", {
        kind: "staff",
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: "/",
      });
      if (res?.error) {
        setError(
          "Invalid email or password. Check your details and try again.",
        );
        return;
      }
      if (!res?.ok) {
        setError("Sign in could not be completed. Please try again.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError(
        "The sign-in service could not be reached. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ahp-login">
      <section className="ahp-login-story">
        <div className="ahp-brand" aria-label="A-Health">
          <BrandLogo />
        </div>
        <div className="ahp-login-intro">
          <p>One connected care workspace</p>
          <h1>Care, clearly connected.</h1>
          <p>
            A calm, secure space for your clinical teams. Put people first,
            coordinate with confidence, and keep care moving.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ahp-login-art"
          src={clinicalArtwork.overview.src}
          alt=""
          width="440"
          height="240"
        />
        <footer>Connecting Healthcare. Empowering Lives.</footer>
      </section>
      <section className="ahp-login-form-area">
        <DisplayPreferences />
        <form onSubmit={staffSignIn} className="ahp-login-form">
          <h2>Welcome back.</h2>
          <p>Sign in to your A-Health workspace with your staff account.</p>
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          <button
            type="button"
            className="ahp-password-toggle"
            aria-pressed={showPassword}
            aria-controls="password"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? "Hide password" : "Show password"}
          </button>
          {error && <Notice>{error}</Notice>}
          <Button type="submit" disabled={busy || sessionStatus === "loading"}>
            {busy ? "Signing in…" : "Sign in"}
            <Icon name="arrow" size={16} />
          </Button>
          <span className="ahp-login-note">
            <Icon name="lock" size={13} />
            Your role determines your workspace access.
          </span>
        </form>
      </section>
    </div>
  );
}
