const form = document.getElementById("loginForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const usuario = document.getElementById("usuario").value;
  const senha = document.getElementById("senha").value;

  const defaultApiBaseUrl =
    "https://institutode139487.rm.cloudtotvs.com.br:2051/api/framework/v1/consultaSQLServer/RealizaConsulta/API.0006/0/V/?parameters=CODCOLIGADA=0;TIPO=funcionario;CPF={cpf}";
  const defaultProxyBaseUrl = "http://localhost:8787/proxy?target=";

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

  async function validateApiAuth({ apiBaseUrl, proxyBaseUrl, user, pass }) {
    const testCpf = "00000000000";
    const targetUrl = buildApiUrl(apiBaseUrl, testCpf);
    const token = base64EncodeUnicode(`${user}:${pass}`);
    const headers = { Accept: "application/json", Authorization: `Basic ${token}` };

    let res;
    try {
      res = await fetch(targetUrl, { method: "GET", headers });
    } catch (err) {
      const proxyUrl = buildProxyUrl(proxyBaseUrl, targetUrl);
      res = await fetch(proxyUrl, { method: "GET", headers });
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

    const apiBaseUrl = localStorage.getItem("apiBaseUrl") || defaultApiBaseUrl;
    const apiProxyBaseUrl = localStorage.getItem("apiProxyBaseUrl") || defaultProxyBaseUrl;

    localStorage.setItem("apiBaseUrl", apiBaseUrl);
    localStorage.setItem("apiProxyBaseUrl", apiProxyBaseUrl);

    sessionStorage.setItem("apiAuthMethod", "basic");
    sessionStorage.setItem("apiUser", usuario.trim());
    sessionStorage.setItem("apiPass", senha);
    sessionStorage.removeItem("apiBearerToken");

    try {
      await validateApiAuth({
        apiBaseUrl,
        proxyBaseUrl: apiProxyBaseUrl,
        user: usuario.trim(),
        pass: senha
      });
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.toLowerCase().includes("failed to fetch")) {
        throw new Error("Não foi possível conectar na API. Inicie o proxy (node proxy.js).");
      }
      throw err;
    }

    window.location.href = "dashboard.html";

  } catch (error) {
    showToast(error.message);
  }
});

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.innerText = message;
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.display = "none";
  }, 3000);
}
