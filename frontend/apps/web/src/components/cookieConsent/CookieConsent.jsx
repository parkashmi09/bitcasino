import { useState } from "react";
import "./CookieConsent.css";

const KEY = "cookie-consent-accepted";

// localStorage throws in some private modes; then the banner just shows again next visit.
const accepted = () => {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
};

export default function CookieConsent() {
  const [open, setOpen] = useState(() => !accepted());
  if (!open) return null;
  const accept = () => {
    try { localStorage.setItem(KEY, "true"); } catch { /* shown again next visit */ }
    setOpen(false);
  };
  return (
    <aside className="cookie-consent" aria-label="Cookie consent">
      <span><a href="/help-center/privacy-policy">We use cookies</a> for functional and analytical purposes.</span>
      <button type="button" onClick={accept}>Accept</button>
    </aside>
  );
}
