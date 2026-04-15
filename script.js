const form = document.getElementById("loginForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const usuario = document.getElementById("usuario").value;
  const senha = document.getElementById("senha").value;
  const envToggle = document.getElementById("envToggle");
  const apiBaseUrlTestInput = document.getElementById("apiBaseUrlTestInput");
  const submitBtn = form.querySelector('button[type="submit"]');
  const submitBtnLabel = submitBtn?.textContent || "Entrar";

  const defaultApiBaseUrlProd =
    "https://institutode137168.rm.cloudtotvs.com.br:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/API.0006/0/V/?parameters=CODCOLIGADA=0;TIPO=funcionario;CPF={cpf}";
  const defaultApiBaseUrlTest =
    "https://institutode139487.rm.cloudtotvs.com.br:2051/api/framework/v1/consultaSQLServer/RealizaConsulta/API.0006/0/V/?parameters=CODCOLIGADA=0;TIPO=funcionario;CPF={cpf}";
  const defaultProxyBaseUrl =
    (window.location.protocol === "http:" || window.location.protocol === "https:") && window.location.port === "8787"
      ? `${window.location.origin}/proxy?target=`
      : "http://localhost:8787/proxy?target=";

  function base64EncodeUnicode(str) {
    const s = String(str ?? "");
    const bytes = new TextEncoder().encode(s);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  function buildApiUrl(base, cpf) {
    const encoded = encodeURIComponent(cpf);
    if (base.includes("{cpf}")) return base.replaceAll("{cpf}", encoded);
    const lower = base.toLowerCase();
    if (lower.includes("parameters=") && !lower.includes("cpf")) return base + ";CPF=" + encoded;
    if (base.endsWith("=") || base.endsWith("/")) return base + encoded;
    if (base.includes("?")) return base + "&cpf=" + encoded;
    return base + "?cpf=" + encoded;
  }

  function buildProxyUrl(proxyBase, targetUrl) {
    const encoded = encodeURIComponent(String(targetUrl || ""));
    if (proxyBase.includes("{target}")) return proxyBase.replaceAll("{target}", encoded);
    if (proxyBase.endsWith("=") || proxyBase.endsWith("/")) return proxyBase + encoded;
    if (proxyBase.includes("?")) return proxyBase + "&target=" + encoded;
    return proxyBase + "?target=" + encoded;
  }

  function shouldUseProxyFirst(proxyBaseUrl) {
    const base = String(proxyBaseUrl || "").trim();
    if (!base) return false;
    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return false;
    try {
      const u = new URL(base, window.location.origin);
      return u.pathname.includes("/proxy");
    } catch {
      return false;
    }
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs || 0) || 0));
    try {
      return await fetch(url, { ...(options || {}), signal: controller.signal });
    } finally {
      clearTimeout(timerId);
    }
  }

  function getApiEnvFromUi() {
    return envToggle?.checked ? "test" : "prod";
  }

  function getApiBaseUrlForEnv(env) {
    if (env === "test") {
      const typed = String(apiBaseUrlTestInput?.value || "").trim();
      if (typed) return typed;
      const saved = String(localStorage.getItem("apiBaseUrlTest") || "").trim();
      return saved || defaultApiBaseUrlTest;
    }
    const saved = String(localStorage.getItem("apiBaseUrlProd") || "").trim();
    return saved || defaultApiBaseUrlProd;
  }

  function normalizeApiBaseUrl(value) {
    const stored = String(value || "").trim();
    return stored;
  }

  function normalizeApiProxyBaseUrl(value) {
    const stored = String(value || "").trim();
    if (!stored) return defaultProxyBaseUrl;

    try {
      const storedUrl = new URL(stored, window.location.origin);
      const defaultUrl = new URL(defaultProxyBaseUrl, window.location.origin);
      if (storedUrl.pathname === defaultUrl.pathname && storedUrl.searchParams.has("target")) {
        return defaultProxyBaseUrl;
      }
      return storedUrl.toString();
    } catch (err) {
      return defaultProxyBaseUrl;
    }
  }

  async function validateApiAuth({ apiBaseUrl, proxyBaseUrl, user, pass, timeoutMs }) {
    const testCpf = "00000000000";
    const targetUrl = buildApiUrl(apiBaseUrl, testCpf);
    const token = base64EncodeUnicode(`${user}:${pass}`);
    const headers = { Accept: "application/json", Authorization: `Basic ${token}` };

    let res;
    const perRequestTimeoutMs = Math.max(1500, Number(timeoutMs || 0) || 0);
    if (shouldUseProxyFirst(proxyBaseUrl)) {
      try {
        const proxyUrl = buildProxyUrl(proxyBaseUrl, targetUrl);
        res = await fetchWithTimeout(proxyUrl, { method: "GET", headers }, perRequestTimeoutMs);
      } catch (err) {
        res = await fetchWithTimeout(targetUrl, { method: "GET", headers }, perRequestTimeoutMs);
      }
    } else {
      try {
        res = await fetchWithTimeout(targetUrl, { method: "GET", headers }, perRequestTimeoutMs);
      } catch (err) {
        const proxyUrl = buildProxyUrl(proxyBaseUrl, targetUrl);
        if (!proxyUrl) throw err;
        res = await fetchWithTimeout(proxyUrl, { method: "GET", headers }, perRequestTimeoutMs);
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error("Usuário ou senha inválidos");
    }
  }

  // Simulação de integração com API RM
  try {
    if (!usuario || !senha) {
      throw new Error("Preencha todos os campos");
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Entrando...";
    }

    const apiEnv = getApiEnvFromUi();
    localStorage.setItem("apiEnv", apiEnv);
    const apiBaseUrl = normalizeApiBaseUrl(getApiBaseUrlForEnv(apiEnv));
    const apiProxyBaseUrl = normalizeApiProxyBaseUrl(localStorage.getItem("apiProxyBaseUrl"));

    localStorage.setItem("apiBaseUrl", apiBaseUrl);
    if (apiEnv === "test") localStorage.setItem("apiBaseUrlTest", apiBaseUrl);
    else localStorage.setItem("apiBaseUrlProd", apiBaseUrl);
    localStorage.setItem("apiProxyBaseUrl", apiProxyBaseUrl);

    sessionStorage.setItem("apiAuthMethod", "basic");
    sessionStorage.setItem("apiUser", usuario.trim());
    sessionStorage.setItem("apiPass", senha);
    sessionStorage.removeItem("apiBearerToken");

    sessionStorage.setItem("pendingAuthValidation", "1");
    sessionStorage.setItem("pendingAuthValidationAt", String(Date.now()));
    window.location.href = "dashboard.html";
    setTimeout(() => {
      const path = String(window.location.pathname || "").toLowerCase();
      if (!path.endsWith("login.html")) return;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtnLabel;
      }
      showToast("Não foi possível redirecionar. Recarregue a página e tente novamente.");
    }, 1500);
    return;

  } catch (error) {
    showToast(error.message);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtnLabel;
    }
  }
});

(() => {
  const envToggle = document.getElementById("envToggle");
  const envLabel = document.getElementById("envLabel");
  const testGroup = document.getElementById("testApiBaseUrlGroup");
  const apiBaseUrlTestInput = document.getElementById("apiBaseUrlTestInput");
  if (!envToggle || !envLabel || !testGroup || !apiBaseUrlTestInput) return;

  const defaultApiBaseUrlProd =
    "https://institutode137168.rm.cloudtotvs.com.br:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/API.0006/0/V/?parameters=CODCOLIGADA=0;TIPO=funcionario;CPF={cpf}";
  const defaultApiBaseUrlTest =
    "https://institutode139487.rm.cloudtotvs.com.br:2051/api/framework/v1/consultaSQLServer/RealizaConsulta/API.0006/0/V/?parameters=CODCOLIGADA=0;TIPO=funcionario;CPF={cpf}";

  const env = localStorage.getItem("apiEnv") === "test" ? "test" : "prod";
  envToggle.checked = env === "test";
  envLabel.textContent = envToggle.checked ? "Teste" : "Produção";
  testGroup.classList.toggle("hidden", !envToggle.checked);

  const savedTest = String(localStorage.getItem("apiBaseUrlTest") || "").trim();
  apiBaseUrlTestInput.value = savedTest || defaultApiBaseUrlTest;

  envToggle.addEventListener("change", () => {
    envLabel.textContent = envToggle.checked ? "Teste" : "Produção";
    testGroup.classList.toggle("hidden", !envToggle.checked);
  });
})();

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.innerText = message;
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.display = "none";
  }, 3000);
}
