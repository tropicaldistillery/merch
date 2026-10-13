// From an invite email: choose a password and be signed in. The link's token
// is taken off the address bar straight away and only ever sent back here.

import { $, api, clearFieldErrors, setAlert, showFieldErrors } from "./core.js";

const form = $("#welcome-form");
const alertBox = $(".form-alert", form);
const password = $("#password");
const confirm = $("#confirm");
const token = new URLSearchParams(location.search).get("invite") || "";
history.replaceState(null, "", "/welcome");

$("#password-show").addEventListener("change", (event) => {
  for (const input of [password, confirm]) input.type = event.target.checked ? "text" : "password";
});

function linkProblem(message) {
  $("#welcome-title").textContent = "This link doesn't work any more";
  $("#welcome-intro").textContent = message;
  $("#welcome-fields").hidden = true;
}

async function init() {
  if (!token) return linkProblem("Open the link from your invite email, or ask the merch admin to send you a new invite.");
  try {
    const invite = await api(`/api/invite?invite=${encodeURIComponent(token)}`);
    const first = (invite.name || "").trim().split(/\s+/)[0];
    if (invite.reset) {
      $("#welcome-eyebrow").textContent = "Tropical Distillery team store";
      $("#welcome-title").textContent = "Choose a new password";
      $("#welcome-submit").textContent = "Save password & sign in";
    }
    $("#welcome-intro").textContent = `${first ? `Hi ${first}. ` : ""}You'll sign in with ${invite.email} and this password.`;
    $("#welcome-email").value = invite.email;
    $("#welcome-fields").hidden = false;
    password.focus();
  } catch (error) {
    linkProblem(error.message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  setAlert(alertBox, "");
  if (password.value !== confirm.value) {
    showFieldErrors(form, { confirm: "The two passwords don't match." });
    confirm.focus();
    return;
  }
  const button = $("#welcome-submit");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const { user } = await api("/api/invite", { method: "POST", body: { token, password: password.value } });
    try {
      localStorage.setItem("tdmerch:last-user", JSON.stringify(user));
    } catch {
      // ignore
    }
    location.replace("/shop");
  } catch (error) {
    if (error.status === 410) return linkProblem(error.message);
    setAlert(alertBox, error.message);
    showFieldErrors(form, error.fieldErrors);
    button.disabled = false;
    button.textContent = label;
  }
});

init();
