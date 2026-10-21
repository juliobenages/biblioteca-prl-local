(() => {
  "use strict";
  const DB_NAME = "biblioteca-prl-local";
  const DB_VERSION = 1;
  const STORE = "documents";
  const fileInput = document.getElementById("fileInput");
  const documentList = document.getElementById("documentList");
  const emptyState = document.getElementById("emptyState");
  const documentCount = document.getElementById("documentCount");
  const importMessage = document.getElementById("importMessage");
  const searchInput = document.getElementById("searchInput");
  const typeFilter = document.getElementById("typeFilter");
  const connectionStatus = document.getElementById("connectionStatus");
  const storageStatus = document.getElementById("storageStatus");
  let db;
  let documents = [];

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("Este navegador no permite almacenamiento local compatible."));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("name", "name", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir la biblioteca local."));
    });
  }

  function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let request;
      try { request = action(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error || new Error("Error en el almacenamiento local."));
      tx.onabort = () => reject(tx.error || new Error("La operación se canceló."));
    });
  }

  const allDocuments = () => transaction("readonly", store => store.getAll());
  const formatSize = bytes => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };
  const formatDate = value => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(value));
  const extension = name => (name.includes(".") ? name.split(".").pop() : "file").toLowerCase();
  const category = file => {
    const ext = extension(file.name);
    if (ext === "pdf") return "pdf";
    if (["txt","md","markdown","html","htm","csv","json","xml","rtf"].includes(ext)) return "text";
    return "other";
  };
  const safeText = value => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const labelFor = ext => ext.length > 5 ? ext.slice(0, 5).toUpperCase() : ext.toUpperCase();
  const textStatusLabel = status => ({
    ready: "Texto extraído",
    empty: "Sin texto extraíble",
    pending: "PDF: lectura pendiente",
    unsupported: "Formato pendiente",
    error: "Error al extraer texto"
  }[status] || "Sin analizar");

  async function loadDocuments() {
    documents = await allDocuments();
    // Backfill text for compatible files already saved by older app versions.
    for (const doc of documents) {
      if (!doc.textStatus && window.PRLTextExtractor && window.PRLTextExtractor.supports(doc.name) && doc.blob) {
        const extracted = await window.PRLTextExtractor.extract(new File([doc.blob], doc.name, { type: doc.type || "" }));
        const updated = { ...doc, textContent: extracted.text, textStatus: extracted.status };
        await transaction("readwrite", store => store.put(updated));
        Object.assign(doc, updated);
      }
    }
    documents.sort((a, b) => b.addedAt - a.addedAt);
    render();
    storageStatus.textContent = "Almacenamiento local activo";
  }

  function render() {
    const query = searchInput.value.trim().toLocaleLowerCase("es");
    const selectedType = typeFilter.value;
    const visible = documents.filter(doc => {
      const searchable = (doc.name + " " + (doc.textContent || "")).toLocaleLowerCase("es");
      const matchesNameOrContent = searchable.includes(query);
      const matchesType = selectedType === "all" || doc.category === selectedType;
      return matchesNameOrContent && matchesType;
    });
    documentCount.textContent = documents.length + (documents.length === 1 ? " archivo" : " archivos");
    documentList.replaceChildren();
    emptyState.hidden = visible.length > 0;
    if (documents.length && visible.length === 0) {
      emptyState.hidden = false;
      emptyState.querySelector("strong").textContent = "No hay coincidencias";
      emptyState.querySelector("p").textContent = "Prueba con otro nombre o filtro.";
    } else {
      emptyState.querySelector("strong").textContent = "Tu biblioteca está vacía";
      emptyState.querySelector("p").textContent = "Importa tu primer documento para empezar.";
    }
    for (const doc of visible) {
      const li = document.createElement("li");
      li.className = "document-item";
      li.innerHTML = `<span class="file-icon" aria-hidden="true">${safeText(labelFor(extension(doc.name)))}</span>
        <div class="file-details"><div class="file-name">${safeText(doc.name)}</div>
        <div class="file-meta">${formatSize(doc.size)} · Añadido el ${formatDate(doc.addedAt)} · ${textStatusLabel(doc.textStatus)}</div></div>
        <div class="file-actions"><button type="button" class="action-button open" data-id="${safeText(doc.id)}">Abrir</button><button type="button" class="action-button delete" data-id="${safeText(doc.id)}">Eliminar</button></div>`;
      documentList.appendChild(li);
    }
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let saved = 0;
    const errors = [];
    importMessage.textContent = "Guardando documentos en este dispositivo…";
    for (const file of files) {
      try {
        const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
        const extracted = window.PRLTextExtractor
          ? await window.PRLTextExtractor.extract(file)
          : { text: "", status: "error" };
        await transaction("readwrite", store => store.put({
          id, name: file.name, size: file.size, type: file.type || "application/octet-stream",
          category: category(file), addedAt: Date.now(), blob: file,
          textContent: extracted.text, textStatus: extracted.status
        }));
        saved++;
      } catch (error) {
        errors.push(file.name + ": " + (error && error.message ? error.message : "no se pudo guardar"));
      }
    }
    await loadDocuments();
    importMessage.textContent = saved + (saved === 1 ? " documento guardado localmente." : " documentos guardados localmente.") + (errors.length ? " No se pudieron guardar: " + errors.join("; ") : "");
    fileInput.value = "";
  }

  documentList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const doc = documents.find(item => item.id === button.dataset.id);
    if (!doc) return;
    if (button.classList.contains("delete")) {
      if (!window.confirm('¿Eliminar "' + doc.name + '" de esta biblioteca local? Esta acción no se puede deshacer.')) return;
      try {
        await transaction("readwrite", store => store.delete(doc.id));
        importMessage.textContent = "Documento eliminado de este dispositivo.";
        await loadDocuments();
      } catch (error) {
        importMessage.textContent = "No se pudo eliminar el documento: " + error.message;
      }
    } else if (button.classList.contains("open")) {
      const url = URL.createObjectURL(doc.blob);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = url;
        link.download = doc.name;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });

  fileInput.addEventListener("change", () => importFiles(fileInput.files));
  searchInput.addEventListener("input", render);
  typeFilter.addEventListener("change", render);
  document.getElementById("refreshButton").addEventListener("click", loadDocuments);

  function updateConnection() {
    const online = navigator.onLine;
    connectionStatus.textContent = online ? "Con conexión" : "Modo sin conexión";
    connectionStatus.previousElementSibling.classList.toggle("online", !online);
  }
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {
      console.warn("No se pudo registrar el modo sin conexión.");
    }));
  }

  openDatabase().then(database => {
    db = database;
    return loadDocuments();
  }).catch(error => {
    storageStatus.textContent = "Almacenamiento no disponible";
    importMessage.textContent = error.message + " Abre la aplicación desde Safari en una dirección HTTPS.";
    fileInput.disabled = true;
  });
  updateConnection();
})();