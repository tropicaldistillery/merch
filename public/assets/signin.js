import { $, api, clearFieldErrors, setAlert, showFieldErrors } from "./core.js";

const form = $("#signin-form");
const nameInput = $("#name");
const emailInput = $("#email");
const codeInput = $("#code");
const alertBox = $(".form-alert", form);
const params = new URLSearchParams(location.search);

// Resolve against this site and keep only the path, so nothing in `next`
// (protocol-relative URLs, stray tabs or backslashes) can leave the site.
function nextPath() {
  try {
    const url = new URL(params.get("next") || "/shop", location.origin);
    if (url.origin === location.origin && url.pathname !== "/") return url.pathname + url.search;
  } catch {
    // fall through
  }
  return "/shop";
}

// Remember who signed in last on this device, never the code.
try {
  const last = JSON.parse(localStorage.getItem("tdmerch:last-user") || "null");
  if (last) {
    nameInput.value = last.name || "";
    emailInput.value = last.email || "";
  }
} catch {
  // ignore
}

async function init() {
  // A link from Slack or email can land here while a session is still valid.
  try {
    await api("/api/session");
    location.replace(nextPath());
    return;
  } catch {
    // not signed in — stay here
  }

  try {
    const config = await api("/api/config");
    if (!config.teamSignIn) {
      setAlert(alertBox, "The store isn't open yet: the team code hasn't been set up. Ask the merch admin.");
      form.querySelector("button[type=submit]").disabled = true;
    }
    if (config.emailDomains.length) {
      const hint = $("#email-hint");
      hint.textContent = `Use your ${config.emailDomains.map((d) => `@${d}`).join(" or ")} address.`;
      hint.hidden = false;
    }
  } catch {
    // The form still works; the server enforces everything.
  }

  (nameInput.value ? (emailInput.value ? codeInput : emailInput) : nameInput).focus();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  setAlert(alertBox, "");

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const { user } = await api("/api/session", {
      method: "POST",
      body: { name: nameInput.value, email: emailInput.value, code: codeInput.value },
    });
    try {
      localStorage.setItem("tdmerch:last-user", JSON.stringify(user));
    } catch {
      // ignore
    }
    location.replace(nextPath());
  } catch (error) {
    setAlert(alertBox, error.message);
    showFieldErrors(form, error.fieldErrors);
    if (error.fieldErrors?.code) codeInput.select();
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

init();
