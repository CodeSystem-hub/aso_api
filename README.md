# Sistema de Importação ASO (HTML/JS)

Aplicação front-end (estática) para importar ASO via planilha, revisar dados, comparar com informações do RM (via API) e executar a integração em duas etapas: **Capa** e **Exames**.

## Estrutura do projeto

- [login.html](login.html) — tela de login
- [script.js](script.js) — lógica do login (autenticação na API)
- [dashboard.html](dashboard.html) — dashboard/importação, filtros, comparação e integração
- [styles.css](styles.css) — estilos (login + dashboard)
- [proxy.js](proxy.js) — proxy local para contornar CORS ao consultar RM
- [backend/main.py](backend/main.py) — servidor local (FastAPI) que serve o front-end e inclui proxy + histórico

## Requisitos

- Navegador moderno (Chrome/Edge/Firefox).
- Para consulta/comparação via RM, normalmente é necessário um proxy/servidor local:
  - Python 3.11+ (recomendado) ou Node.js 18+.

## Como executar

### Opção A) Servidor local (Python) (recomendado)

1. No terminal, dentro da pasta do projeto:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r .\backend\requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8787
```

2. Abra no navegador:

```text
http://localhost:8787/login.html
```

Essa opção já inclui:

- `/proxy` para chamadas RM (CORS)
- `/save` e `/history/list` para salvar/listar relatórios `.xlsx` em `historico/`

### Opção B) Live Server

1. Abra a pasta no VS Code.
2. Use a extensão “Live Server” e abra `login.html`.
3. O projeto usa a porta configurada em `.vscode/settings.json` (padrão: `5501`).

### Opção C) Abrir o HTML diretamente

Você pode abrir `login.html` no navegador, mas chamadas de rede podem ter limitações maiores (CORS). Para usar API do RM, prefira a Opção A + proxy.

## Proxy local (para CORS)

O RM normalmente não permite chamadas diretas do browser por CORS. Para isso existe um proxy simples:

1. No terminal, dentro da pasta do projeto:

```powershell
node .\proxy.js
```

2. O proxy sobe em `http://localhost:8787`.
3. Use o proxy quando a chamada direta falhar por CORS (`Failed to fetch`).

Observação: o proxy aceita somente destinos `https://*.rm.cloudtotvs.com.br` (whitelist).

## Login

O login autentica usando **Basic Auth** na API do RM (o usuário/senha digitados no login).

- As credenciais são mantidas apenas em `sessionStorage` (sessão do navegador).
- Ao sair, as credenciais são removidas.

## Importação (planilha)

### Formatos suportados

- `.xlsx` / `.xls` / `.csv`

Para Excel, o projeto usa SheetJS via CDN no `dashboard.html`.

### Modos (importação por partes)

No dashboard existem dois modos:

- **Capa do ASO (parte 1)**: agrega registros por colaborador/data e prepara a capa.
- **Exames (parte 2)**: lista os exames dentro da capa.

Regra: o sistema bloqueia “Exames” até a “Capa” ser integrada.

### Código da capa

- O código `10101012` é tratado como **código da capa** (não é exame).

## Mapeamento de colunas (importação personalizada)

Clique em **Mapeamento** para selecionar qual coluna do arquivo alimenta cada campo. Use:

- **Aplicar**: aplica o mapeamento selecionado.
- **Padrão**: volta ao auto-mapeamento.

## Filtros e busca

- Campo “Buscar (texto livre)” filtra a lista.
- Em cada coluna existe um filtro `▾` no cabeçalho (estilo Excel), com:
  - buscar valores,
  - selecionar/desselecionar,
  - aplicar/limpar.

## Consulta/Comparação com API

- Use **Consultar/Comparar** para consultar a API e preencher na lista:
  - **Matrícula (API)**: vem da coluna **CHAPA** do retorno da API
  - **Situação**: vem de **CODSITUACAO** e escolhe a situação mais recente quando houver múltiplos registros
- A tela mostra:
  - contador `API X/Y`
  - barra de progresso durante a execução

### Regra de negócio (Periódico + Situação D)

- Exames do tipo **Periódico** nunca são considerados para situação **D**.
- Quando a situação retornada for **D**, os exames periódicos são ignorados para integração.

## Segurança

- Não coloque credenciais em arquivos do repositório.
- Se credenciais forem expostas por engano, troque a senha imediatamente.

## Observações e limitações

- O servidor Python é opcional, mas recomendado para reduzir problemas de CORS e salvar histórico em pasta.
