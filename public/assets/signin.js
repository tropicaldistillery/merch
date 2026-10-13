import { $, api, clearFieldErrors, setAlert, showFieldErrors } from "./core.js";

const form = $("#signin-form");
const nameInput = $("#name");
const emailInput = $("#email");
const codeInput = $("#code");
const alertBox = $(".form-alert", form);
const params = new URLSearchParams(location.search);
const repToggle = $("#rep-toggle");
let personal = false;
let rep = false;
// What the page says for the team, kept so switching back restores it.
const teamText = {};
const TEXT_IDS = ["signin-eyebrow", "signin-intro", "email-label", "code-label"];

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

$("#code-show").addEventListener("change", (event) => {
  codeInput.type = event.target.checked ? "text" : "password";
});

// Remember who signed in last on this device, never the code.
let last = null;
try {
  last = JSON.parse(localStorage.getItem("tdmerch:last-user") || "null");
  if (last) {
    nameInput.value = last.name || "";
    emailInput.value = last.email || "";
  }
} catch {
  // ignore
}

// Distributor reps sign in with their distributor's shared code, their own
// name and any email, whichever way the team signs in.
function setRep(on) {
  rep = on;
  for (const id of TEXT_IDS) $(`#${id}`).textContent = on ? REP_TEXT[id] : teamText[id];
  $("#name-field").hidden = personal && !on;
  $("#email-hint").hidden = on || !$("#email-hint").textContent;
  const hint = $("#code-hint");
  if (on) {
    hint.dataset.team ??= hint.hidden ? "" : hint.textContent;
    hint.textContent = "It starts with td-, like td-rbgfl. Ask your distributor or your Tropical Distillery contact if you don't have it.";
    hint.hidden = false;
  } else if (hint.dataset.team !== undefined) {
    hint.textContent = hint.dataset.team;
    hint.hidden = !hint.dataset.team;
  }
  repToggle.textContent = on ? "On the Tropical Distillery team? Sign in with your team code" : "Distributor rep? Sign in with your distributor's code";
}

const REP_TEXT = {
  "signin-eyebrow": "Distributor reps",
  "signin-intro": "Use the code your distributor shared, with your own name and email. You'll stay signed in on this device for 30 days.",
  "email-label": "Email",
  "code-label": "Distributor code",
};

repToggle.addEventListener("click", () => {
  setRep(!rep);
  (rep && !nameInput.value ? nameInput : codeInput).focus();
});

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
    if (config.signInMode === "personal") {
      // Everyone has their own password or code; the name comes from the team list.
      personal = true;
      $("#name-field").hidden = true;
      $("#email-label").textContent = "Email";
      $("#code-label").textContent = "Password";
      const hint = $("#code-hint");
      hint.textContent =
        "The one you created from your invite email. If you were sent a code like tropical-jane-4821 instead, that works too. No password yet? Ask the merch admin for an invite.";
      hint.hidden = false;
      $("#signin-intro").textContent = "Use your email and your password. You'll stay signed in on this device for 30 days.";
    } else if (config.accounts) {
      // The shared code still works, and so does a password of their own.
      $("#code-label").textContent = "Team code or your password";
      const hint = $("#code-hint");
      hint.textContent = "Created your own password from an invite? Use it with your email; your name is already on file.";
      hint.hidden = false;
    }
    if (!config.teamSignIn) {
      setAlert(alertBox, "The store isn't open yet: the team code hasn't been set up. Ask the merch admin.");
      form.querySelector("button[type=submit]").disabled = true;
    }
    if (config.emailDomains.length) {
      const hint = $("#email-hint");
      hint.textContent = `Use your ${config.emailDomains.map((d) => `@${d}`).join(" or ")} address.`;
      hint.hidden = false;
    }
    for (const id of TEXT_IDS) teamText[id] = $(`#${id}`).textContent;
    if (config.distributorSignIn) {
      repToggle.hidden = false;
      if (last?.distributor) setRep(true);
    }
  } catch {
    // The form still works; the server enforces everything.
  }

  const firstEmpty = [personal && !rep ? null : nameInput, emailInput, codeInput].find((input) => input && !input.value);
  (firstEmpty ?? codeInput).focus();
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
    // A distributor's code typed on the team form: ask for their name too.
    if (error.fieldErrors?.name && !rep) setRep(true);
    setAlert(alertBox, error.message);
    showFieldErrors(form, error.fieldErrors);
    if (error.fieldErrors?.name && !nameInput.value) nameInput.focus();
    else if (error.fieldErrors?.code) codeInput.select();
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

init();
