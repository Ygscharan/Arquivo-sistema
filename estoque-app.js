let db = { caixas: [], prateleiras: [], processos: [], unidades: [], responsaveis: [], relacoes: [] };
    let edit=null, pastaHandle, lastHash = "";
    let editBoxFull = null;
    let indexMetadata = { size: 0, lastModified: 0 };
    let configMetadata = { size: 0, lastModified: 0 };
    
    // --- Variáveis de Controle da Paginação ---
    let paginaAtual = 1;
    const itensPorPagina = 50; 
    
    let paginaAtualMapa = 1;       
    const prateleirasPorPagina = 10; 

    // ADICIONE ESTAS DUAS LINHAS:
    let paginaAtualAvulsas = 1;
    const itensPorPaginaAvulsas = 50;
    let paginaAtualConfigPrat = 1;
    const itensPorPaginaConfigPrat = 50;
    let paginaAtualRelacoes = 1;
    const itensPorPaginaRelacoes = 10;
    // ------------------------------------------

    let _dashChart1 = null, _dashChart2 = null;
    let dashProcessoInicializado = false;
    const ERP_PAGE_ID = window.ERP_PAGE_ID || "index";

    let _loadingOverlayCount = 0;
    let _dashDebounceTimer = null;
    let caixaIndexPorNome = null;
    let _documentosIndiceSincronizado = false;

    function garantirOverlayCarregamento(){
        if(document.getElementById("erpLoadingOverlay")) return;
        const el = document.createElement("div");
        el.id = "erpLoadingOverlay";
        el.setAttribute("role", "alert");
        el.setAttribute("aria-live", "polite");
        el.innerHTML = '<div class="erp-loading-box"><div class="erp-loading-spinner"></div><p class="erp-loading-text" id="erpLoadingText">Processando…</p></div>';
        document.body.appendChild(el);
    }

    function mostrarCarregamento(texto){
        garantirOverlayCarregamento();
        _loadingOverlayCount++;
        const txt = document.getElementById("erpLoadingText");
        if(txt) txt.textContent = texto || "Processando…";
        document.getElementById("erpLoadingOverlay").classList.add("ativo");
    }

    function esconderCarregamento(){
        _loadingOverlayCount = Math.max(0, _loadingOverlayCount - 1);
        if(_loadingOverlayCount === 0){
            const ov = document.getElementById("erpLoadingOverlay");
            if(ov) ov.classList.remove("ativo");
        }
    }

    async function executarComCarregamento(fn, texto){
        mostrarCarregamento(texto);
        try{
            return await fn();
        } finally {
            esconderCarregamento();
        }
    }

    function rebuildCaixaIndexMap(){
        caixaIndexPorNome = new Map();
        (db.caixas || []).forEach((c, i) => {
            caixaIndexPorNome.set(String(c.caixa).trim().toLowerCase(), i);
        });
    }

    function indiceCaixaPorNome(nome){
        if(!caixaIndexPorNome) rebuildCaixaIndexMap();
        return caixaIndexPorNome.get(String(nome).trim().toLowerCase());
    }

    function criarShortItem(cFull){
        return {
            caixa: cFull.caixa,
            unidade: cFull.unidade || "",
            validade: cFull.validade || "",
            prateleira: cFull.prateleira || "",
            nivel: cFull.nivel || 0,
            espaco: cFull.espaco || 0,
            status: cFull.status || "",
            usuario: cFull.usuario || "",
            processos: cFull.processos || [],
            dataUpdate: cFull.dataUpdate || "",
            documentos: parseInt(cFull.documentos, 10) || 0
        };
    }

    function abrirModal(htmlCorpo, opcoes){
        opcoes = opcoes || {};
        const modal = document.getElementById("modal");
        const conteudo = document.getElementById("modalConteudo");
        if(!modal || !conteudo) return;
        const mb = document.querySelector("#modal .modalBox");
        if(mb){
            if(opcoes.wide !== false) mb.classList.add("modal-wide");
            else mb.classList.remove("modal-wide");
        }
        const footer = opcoes.footer || "";
        if(footer){
            conteudo.innerHTML = '<div class="modal-inner"><div class="modal-scroll-body">' + htmlCorpo + '</div><div class="modal-footer-actions">' + footer + '</div></div>';
        } else if(opcoes.htmlCompleto){
            conteudo.innerHTML = opcoes.htmlCompleto;
        } else {
            conteudo.innerHTML = '<div class="modal-inner"><div class="modal-scroll-body">' + htmlCorpo + '</div></div>';
        }
        modal.style.display = "flex";
    }

    // Proteção Imediata: Verifica a sessão e permissões assim que a página carrega
    function verificarSessao() {
        if (ERP_PAGE_ID !== "login") {
            const usuarioLogadoStr = sessionStorage.getItem("usuarioLogado");
            if (!usuarioLogadoStr) {
                window.location.replace("login.html");
            } else if (usuarioLogadoStr !== "admin_provisorio") {
                try {
                    const u = JSON.parse(usuarioLogadoStr);
                    if (ERP_PAGE_ID === "digitalizacao" && u.funcao !== "Digitalizador" && u.funcao !== "Administrador") {
                        window.location.replace("dashboard.html");
                    }
                    if (ERP_PAGE_ID === "preparacao" && u.funcao !== "Preparador Chefe" && u.funcao !== "Administrador") {
                        window.location.replace("dashboard.html");
                    }
                } catch(e) {}
            }
        } else {
            // Ao voltar ou acessar a tela de login, o sistema deve registrar o logoff
            sessionStorage.removeItem("usuarioLogado");
        }
    }
    
    verificarSessao();
    
    // Proteção adicional para quando o usuário usa os botões de voltar/avançar do navegador (evita exibir página em cache)
    window.addEventListener("pageshow", function(event) {
        if (event.persisted) { // se a página foi carregada do cache
            verificarSessao();
        }
    });

    const IDB_NOME = "erp-estoque-fs";
    const IDB_STORE = "config";
    const IDB_KEY_PASTA = "directoryHandle";
    const IDB_VERSAO = 2;
    let pastaHandlePendente = null;

    function abrirIndexedDB(){
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NOME, IDB_VERSAO);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (ev) => {
                const database = ev.target.result;
                if(!database.objectStoreNames.contains(IDB_STORE))
                    database.createObjectStore(IDB_STORE);
            };
        });
    }

    async function salvarPastaNoIndice(dirHandle){
        try{
            const idb = await abrirIndexedDB();
            await new Promise((resolve, reject) => {
                const tx = idb.transaction(IDB_STORE, "readwrite");
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error || new Error("IndexedDB abort"));
                tx.onerror = () => reject(tx.error);
                tx.objectStore(IDB_STORE).put(dirHandle, IDB_KEY_PASTA);
            });
            const nome = dirHandle && dirHandle.name ? dirHandle.name : "";
            if(nome){
                localStorage.setItem("pastaId", nome);
                localStorage.setItem("pastaNomeUltima", nome);
            }
        }catch(e){
            console.error("Falha ao guardar pasta no IndexedDB:", e);
            alert("Não foi possível memorizar a pasta neste navegador. Abra o app por http://localhost ou HTTPS e use Chrome/Edge. Evite abrir o arquivo direto (file://).");
        }
    }

    async function lerPastaDoIndice(){
        const idb = await abrirIndexedDB();
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(IDB_STORE, "readonly");
            const req = tx.objectStore(IDB_STORE).get(IDB_KEY_PASTA);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function permissaoJaConcedida(handle){
        const opt = { mode: "readwrite" };
        try{
            if(typeof handle.queryPermission !== "function") return true;
            return (await handle.queryPermission(opt)) === "granted";
        }catch(e){
            console.warn(e);
            return false;
        }
    }

    async function garantirPermissaoAposSelecao(handle){
        const opt = { mode: "readwrite" };
        try{
            if(typeof handle.queryPermission !== "function") return true;
            if((await handle.queryPermission(opt)) === "granted") return true;
            if(typeof handle.requestPermission === "function")
                return (await handle.requestPermission(opt)) === "granted";
        }catch(e){ console.warn(e); }
        return false;
    }

    function mostrarBarraReconectar(nomePasta){
        const bar = document.getElementById("barraReconectarPasta");
        const txt = document.getElementById("barraReconectarTexto");
        if(!bar || !txt) return;
        const n = nomePasta || localStorage.getItem("pastaNomeUltima") || "sua pasta de dados";
        txt.innerHTML = "Esta sessão precisa de <strong>um clique</strong> para voltar a acessar a pasta memorizada: <strong>" + escapeHtmlUi(n) + "</strong>. (O navegador exige isso ao reabrir.)";
        bar.style.display = "flex";
        const slBar = document.getElementById("syncLabel");
        if(slBar) slBar.innerText = "Aguardando permissão…";
    }

    function esconderBarraReconectar(){
        const bar = document.getElementById("barraReconectarPasta");
        if(bar) bar.style.display = "none";
        pastaHandlePendente = null;
    }

    function escapeHtmlUi(s){
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    async function reconectarPastaSalva(){
        let h = pastaHandlePendente || await lerPastaDoIndice();
        if(!h){
            alert("Nenhuma pasta memorizada. Use o menu → Alterar pasta.");
            return selecionarPasta();
        }
        try{
            if(typeof h.requestPermission !== "function"){
                pastaHandle = h;
                await salvarPastaNoIndice(pastaHandle);
                await carregarDB();
                esconderBarraReconectar();
                return;
            }
            const r = await h.requestPermission({ mode: "readwrite" });
            if(r !== "granted"){
                alert("Permissão negada. Tente de novo ou escolha outra pasta.");
                return;
            }
            pastaHandle = h;
            pastaHandlePendente = null;
            await salvarPastaNoIndice(pastaHandle);
            await carregarDB();
            esconderBarraReconectar();
        }catch(e){
            console.error(e);
            alert("Não foi possível restabelecer o acesso. Escolha a pasta novamente no menu.");
        }
    }

    async function escolherOutraPastaManual(){
        esconderBarraReconectar();
        await selecionarPasta();
        if(!pastaHandle){
            const slM = document.getElementById("syncLabel");
            if(slM) slM.innerText = "Escolha a pasta no menu (☰)";
        }
    }

    window.onload = async function(){
        if(ERP_PAGE_ID === "lancamento" && !new URLSearchParams(location.search).has("edit"))
            sessionStorage.removeItem("erpEditParam");
        
        mostrarCarregamento("Iniciando sistema…");
        try {
            await inicializarPasta();
        } finally {
            esconderCarregamento();
        }

        verificarAutenticacao();

        if(ERP_PAGE_ID === "dashboard") atualizarDashboard();
        if(ERP_PAGE_ID === "mapa") mapa();
        if(ERP_PAGE_ID === "avulsas") renderAvulsas();
        if(ERP_PAGE_ID === "preparacao") atualizarTelaPreparacao();
        if(ERP_PAGE_ID === "digitalizacao") atualizarTelaDigitalizacao();
        if(ERP_PAGE_ID === "relacao") atualizarTelaRelacao();
        if(ERP_PAGE_ID === "importar") atualizarTelaImportacao();

        if (ERP_PAGE_ID === "login") {            atualizarTelaLogin();
        }

        setInterval(async () => { if(pastaHandle && edit===null) await carregarDB(true); }, 5000);
    };

    function verificarAutenticacao() {
        // Se ainda não carregou o DB ou a pasta não foi selecionada, aguarda
        if (!db || !db.responsaveis) return;
        
        // Se a página for de login, não redireciona para o login de novo
        if (ERP_PAGE_ID === "login") return;

        // Se o DB estiver vazio ou não tiver ninguém com login/senha cadastrado, pode liberar ou obrigar a cadastrar
        const temUsuarioComSenha = db.responsaveis.some(r => r.login && r.senha);
        
        if (temUsuarioComSenha) {
            const usuarioLogado = sessionStorage.getItem("usuarioLogado");
            if (!usuarioLogado) {
                window.location.href = "login.html";
            } else if (usuarioLogado !== "admin_provisorio") {
                try {
                    const u = JSON.parse(usuarioLogado);
                    if (ERP_PAGE_ID === "digitalizacao" && u.funcao !== "Digitalizador" && u.funcao !== "Administrador") {
                        window.location.href = "dashboard.html";
                    }
                    if (ERP_PAGE_ID === "preparacao" && u.funcao !== "Preparador Chefe" && u.funcao !== "Administrador") {
                        window.location.href = "dashboard.html";
                    }
                } catch(e) {}
            }
        }
    }

    function atualizarTelaLogin() {
        const warning = document.getElementById("folderWarning");
        const form = document.getElementById("loginForm");
        
        if (!pastaHandle) {
            warning.style.display = "block";
            form.style.display = "none";
        } else {
            warning.style.display = "none";
            form.style.display = "flex";
            
            const temUsuarioComSenha = db.responsaveis && db.responsaveis.some(r => r.login && r.senha);
            if (!temUsuarioComSenha && db.responsaveis) {
                document.getElementById("loginError").innerHTML = "Nenhum usuário com login/senha cadastrado.<br>Acesso livre provisoriamente.";
                document.getElementById("loginError").style.color = "#27ae60";
                document.getElementById("loginBtn").innerText = "Entrar no Sistema";
            }

            const datalist = document.getElementById("loginHistory");
            if (datalist) {
                try {
                    const historicoStr = localStorage.getItem("loginHistory") || "[]";
                    const historico = JSON.parse(historicoStr);
                    datalist.innerHTML = historico.map(u => `<option value="${u}">`).join("");
                } catch(e) {}
            }
        }
    }

    function realizarLogin(event) {
        event.preventDefault();
        const user = document.getElementById("loginUsername").value.trim();
        const pass = document.getElementById("loginPassword").value.trim();
        const err = document.getElementById("loginError");

        const temUsuarioComSenha = db.responsaveis && db.responsaveis.some(r => r.login && r.senha);

        if (!temUsuarioComSenha) {
            sessionStorage.setItem("usuarioLogado", "admin_provisorio");
            window.location.href = "index.html";
            return;
        }

        const resp = db.responsaveis.find(r => r.login === user && r.senha === pass);

        if (resp) {
            try {
                const historicoStr = localStorage.getItem("loginHistory") || "[]";
                let historico = JSON.parse(historicoStr);
                if (!historico.includes(user)) {
                    historico.push(user);
                    localStorage.setItem("loginHistory", JSON.stringify(historico));
                }
            } catch(e) {}

            sessionStorage.setItem("usuarioLogado", JSON.stringify(resp));
            if (resp.funcao === "Preparador Chefe") {
                window.location.href = "preparacao.html";
            } else if (resp.funcao === "Digitalizador") {
                window.location.href = "digitalizacao.html";
            } else {
                window.location.href = "index.html";
            }
        } else {
            err.innerText = "Login ou senha incorretos!";
        }
    }
    function aplicarEdicaoSeNecessario(){
        const params = new URLSearchParams(location.search);
        let q = params.get("edit");
        if(q !== null && q !== ""){
            sessionStorage.setItem("erpEditParam", q);
            history.replaceState({}, "", location.pathname + location.hash);
        } else {
            q = sessionStorage.getItem("erpEditParam");
        }
        if(q === null || q === "") return;
        const i = parseInt(q, 10);
        if(isNaN(i) || !db.caixas[i]) return;
        sessionStorage.removeItem("erpEditParam");
        preencherFormularioEdicao(i);
    }

    async function inicializarPasta(){
        if(!window.showDirectoryPicker){
            alert("Este navegador não suporta escolha de pasta (use Chrome ou Edge em ambiente seguro https/localhost).");
            return;
        }
        if(window.location.protocol === "file:"){
            console.warn("Abrir o HTML por file:// limita a memória da pasta. Prefira abrir pela mesma origem (ex.: Live Server ou python -m http.server).");
        }
        try{
            const salvo = await lerPastaDoIndice();
            if(salvo){
                pastaHandlePendente = salvo;
                if(await permissaoJaConcedida(salvo)){
                    pastaHandle = salvo;
                    pastaHandlePendente = null;
                    await carregarDB();
                    if(pastaHandle && pastaHandle.name){
                        localStorage.setItem("pastaId", pastaHandle.name);
                        localStorage.setItem("pastaNomeUltima", pastaHandle.name);
                    }
                    esconderBarraReconectar();
                    return;
                }
                mostrarBarraReconectar(salvo.name);
                return;
            }
        }catch(e){
            console.warn("Não foi possível ler a pasta salva:", e);
        }
        await selecionarPasta();
        if(!pastaHandle){
            const slI = document.getElementById("syncLabel");
            if(slI) slI.innerText = "Escolha a pasta no menu (☰)";
        }
    }

    async function selecionarPasta(){
        esconderBarraReconectar();
        try{
            pastaHandle = await window.showDirectoryPicker({ mode: "readwrite" });
            const permitido = await garantirPermissaoAposSelecao(pastaHandle);
            if(!permitido){
                pastaHandle = null;
                return alert("Permissão negada. A pasta não pôde ser usada.");
            }
            await salvarPastaNoIndice(pastaHandle);
            await carregarDB();
        }catch(err){
            if(err && err.name !== "AbortError")
                console.error(err);
        }
    }

    
    // --- FUNÇÕES AUXILIARES DE CACHE INDEXEDDB E LOCK COOPERATIVO ---
    const IDB_CACHE_DB = "erp-estoque-cache";
    const IDB_CACHE_STORE = "index_cache";
    
    function abrirCacheIndexedDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_CACHE_DB, 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (ev) => {
                const database = ev.target.result;
                if(!database.objectStoreNames.contains(IDB_CACHE_STORE))
                    database.createObjectStore(IDB_CACHE_STORE);
            };
        });
    }
    
    async function salvarIndexNoCache(list, size, lastModified) {
        try {
            const idb = await abrirCacheIndexedDB();
            await new Promise((resolve, reject) => {
                const tx = idb.transaction(IDB_CACHE_STORE, "readwrite");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                const store = tx.objectStore(IDB_CACHE_STORE);
                store.put(list, "caixas_list");
                store.put({ size, lastModified }, "caixas_metadata");
            });
        } catch(e) {
            console.error("Falha ao salvar cache no IndexedDB:", e);
        }
    }
    
    async function lerIndexDoCache() {
        try {
            const idb = await abrirCacheIndexedDB();
            const meta = await new Promise((resolve, reject) => {
                const tx = idb.transaction(IDB_CACHE_STORE, "readonly");
                const req = tx.objectStore(IDB_CACHE_STORE).get("caixas_metadata");
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
            if (!meta) return null;
            
            const list = await new Promise((resolve, reject) => {
                const tx = idb.transaction(IDB_CACHE_STORE, "readonly");
                const req = tx.objectStore(IDB_CACHE_STORE).get("caixas_list");
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
            return { list, meta };
        } catch(e) {
            console.error("Falha ao ler cache do IndexedDB:", e);
            return null;
        }
    }

    async function acquireLock(userName) {
        const lockFileName = "db.lock";
        const clientId = userName + "_" + Math.random().toString(36).substring(2, 9);
        const timeout = 8000;
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            try {
                let lockHandle;
                try {
                    lockHandle = await pastaHandle.getFileHandle(lockFileName, { create: false });
                } catch (e) {
                    lockHandle = await pastaHandle.getFileHandle(lockFileName, { create: true });
                }
                
                const file = await lockHandle.getFile();
                const text = await file.text();
                
                let isExpired = false;
                let currentLock = null;
                if (text) {
                    try {
                        currentLock = JSON.parse(text);
                        if (Date.now() - currentLock.timestamp > 10000) {
                            isExpired = true;
                        }
                    } catch (err) {
                        isExpired = true; 
                    }
                }
                
                if (!text || isExpired || (currentLock && currentLock.clientId === clientId)) {
                    const writable = await lockHandle.createWritable();
                    await writable.write(JSON.stringify({
                        clientId: clientId,
                        userName: userName,
                        timestamp: Date.now()
                    }));
                    await writable.close();
                    
                    await new Promise(r => setTimeout(r, 40));
                    
                    const verifyFile = await lockHandle.getFile();
                    const verifyText = await verifyFile.text();
                    const verifyLock = JSON.parse(verifyText);
                    if (verifyLock.clientId === clientId) {
                        return clientId; 
                    }
                }
            } catch (e) {
                console.warn("Tentativa de lock falhou:", e);
            }
            
            await new Promise(r => setTimeout(r, 80));
        }
        throw new Error("O banco de dados está ocupado por outro computador. Aguarde alguns segundos.");
    }

    async function releaseLock(clientId) {
        try {
            const lockHandle = await pastaHandle.getFileHandle("db.lock", { create: false });
            const file = await lockHandle.getFile();
            const text = await file.text();
            if (text) {
                const currentLock = JSON.parse(text);
                if (currentLock.clientId === clientId) {
                    await pastaHandle.removeEntry("db.lock");
                }
            }
        } catch (e) {
            // Se já foi deletado, ignora
        }
    }

    async function carregarDetalhesCaixa(caixa, prateleira, status) {
        if (!pastaHandle) return null;
        try {
            let list = [];
            if (status === "Eliminada") {
                const hFile = await pastaHandle.getFileHandle("caixas_eliminadas.json", { create: false });
                const file = await hFile.getFile();
                list = JSON.parse(await file.text() || "[]");
            } else if (!prateleira || !prateleira.trim()) {
                const hFile = await pastaHandle.getFileHandle("caixas_avulsas.json", { create: false });
                const file = await hFile.getFile();
                list = JSON.parse(await file.text() || "[]");
            } else {
                const subFolder = await pastaHandle.getDirectoryHandle("caixas_prateleiras", { create: false });
                const hFile = await subFolder.getFileHandle(`prateleira_${prateleira.trim()}.json`, { create: false });
                const file = await hFile.getFile();
                list = JSON.parse(await file.text() || "[]");
            }
            return list.find(c => c.caixa === caixa) || null;
        } catch (e) {
            console.error("Erro ao carregar detalhes da caixa:", e);
            return null;
        }
    }

    async function migrarBancoDadosSeNecessario(dirHandle) {
        let oldDbFile;
        try {
            oldDbFile = await dirHandle.getFileHandle("banco_erp.json", { create: false });
        } catch (e) {
            try {
                await dirHandle.getFileHandle("config_erp.json", { create: false });
                return; 
            } catch (err) {
                await inicializarNovoBanco(dirHandle);
                return;
            }
        }

        console.log("Banco monolithic banco_erp.json encontrado. Iniciando migração...");
        const file = await oldDbFile.getFile();
        const text = await file.text();
        if (!text) {
            await inicializarNovoBanco(dirHandle);
            await dirHandle.removeEntry("banco_erp.json");
            return;
        }

        let oldDb;
        try {
            oldDb = JSON.parse(text);
        } catch (e) {
            console.error("Erro ao analisar banco_erp.json:", e);
            alert("O arquivo banco_erp.json está corrompido. Um novo banco será criado.");
            await inicializarNovoBanco(dirHandle);
            await dirHandle.removeEntry("banco_erp.json");
            return;
        }

        const backupHandle = await dirHandle.getFileHandle("banco_erp_backup.json", { create: true });
        const writableBackup = await backupHandle.createWritable();
        await writableBackup.write(text);
        await writableBackup.close();

        const configData = {
            prateleiras: oldDb.prateleiras || [],
            processos: oldDb.processos || [],
            unidades: oldDb.unidades || [],
            responsaveis: oldDb.responsaveis || [],
            relacoes: oldDb.relacoes || []
        };
        const configHandle = await dirHandle.getFileHandle("config_erp.json", { create: true });
        const writableConfig = await configHandle.createWritable();
        await writableConfig.write(JSON.stringify(configData, null, 2));
        await writableConfig.close();

        const caixas = oldDb.caixas || [];
        const indexList = [];
        const prateleirasMap = {};
        const avulsas = [];
        const eliminadas = [];

        const subFolder = await dirHandle.getDirectoryHandle("caixas_prateleiras", { create: true });

        for (let c of caixas) {
            indexList.push({
                caixa: c.caixa,
                unidade: c.unidade || "",
                validade: c.validade || "",
                prateleira: c.prateleira || "",
                nivel: c.nivel || 0,
                espaco: c.espaco || 0,
                status: c.status || "",
                usuario: c.usuario || "",
                processos: c.processos || [],
                dataUpdate: c.dataUpdate || "",
                documentos: parseInt(c.documentos, 10) || 0
            });

            const fullDetail = {
                caixa: c.caixa,
                unidade: c.unidade || "",
                inicio: c.inicio || "",
                fim: c.fim || "",
                validade: c.validade || "",
                prateleira: c.prateleira || "",
                nivel: c.nivel || 0,
                espaco: c.espaco || 0,
                status: c.status || "",
                usuario: c.usuario || "",
                processos: c.processos || [],
                dataUpdate: c.dataUpdate || "",
                historico: c.historico || []
            };

            if (c.status === "Eliminada") {
                eliminadas.push(fullDetail);
            } else if (!c.prateleira || !c.prateleira.trim()) {
                avulsas.push(fullDetail);
            } else {
                const pNome = c.prateleira.trim();
                if (!prateleirasMap[pNome]) prateleirasMap[pNome] = [];
                prateleirasMap[pNome].push(fullDetail);
            }
        }

        const indexHandle = await dirHandle.getFileHandle("caixas_index.json", { create: true });
        const writableIndex = await indexHandle.createWritable();
        await writableIndex.write(JSON.stringify(indexList));
        await writableIndex.close();

        for (let pNome of Object.keys(prateleirasMap)) {
            const fileP = await subFolder.getFileHandle(`prateleira_${pNome}.json`, { create: true });
            const writableP = await fileP.createWritable();
            await writableP.write(JSON.stringify(prateleirasMap[pNome]));
            await writableP.close();
        }

        const avulsasHandle = await dirHandle.getFileHandle("caixas_avulsas.json", { create: true });
        const writableAvulsas = await avulsasHandle.createWritable();
        await writableAvulsas.write(JSON.stringify(avulsas));
        await writableAvulsas.close();

        const eliminadasHandle = await dirHandle.getFileHandle("caixas_eliminadas.json", { create: true });
        const writableEliminadas = await eliminadasHandle.createWritable();
        await writableEliminadas.write(JSON.stringify(eliminadas));
        await writableEliminadas.close();

        await dirHandle.removeEntry("banco_erp.json");
        console.log("Migração concluída com sucesso!");
    }

    async function inicializarNovoBanco(dirHandle) {
        const configData = { prateleiras: [], processos: [], unidades: [], responsaveis: [], relacoes: [] };
        const hConfig = await dirHandle.getFileHandle("config_erp.json", { create: true });
        const wConfig = await hConfig.createWritable();
        await wConfig.write(JSON.stringify(configData, null, 2));
        await wConfig.close();

        const hIndex = await dirHandle.getFileHandle("caixas_index.json", { create: true });
        const wIndex = await hIndex.createWritable();
        await wIndex.write(JSON.stringify([]));
        await wIndex.close();

        const hAvulsas = await dirHandle.getFileHandle("caixas_avulsas.json", { create: true });
        const wAvulsas = await hAvulsas.createWritable();
        await wAvulsas.write(JSON.stringify([]));
        await wAvulsas.close();

        const hEliminadas = await dirHandle.getFileHandle("caixas_eliminadas.json", { create: true });
        const wEliminadas = await hEliminadas.createWritable();
        await wEliminadas.write(JSON.stringify([]));
        await wEliminadas.close();

        await dirHandle.getDirectoryHandle("caixas_prateleiras", { create: true });
    }

    async function sincronizarDocumentosIndiceSeNecessario(){
        if(!pastaHandle || _documentosIndiceSincronizado) return;
        const precisa = (db.caixas || []).some(c => c.documentos === undefined || c.documentos === null);
        if(!precisa){
            _documentosIndiceSincronizado = true;
            return;
        }

        const mapDocs = new Map();
        async function absorverLista(list){
            (list || []).forEach(c => {
                const docs = parseInt(c.documentos, 10) || 0;
                if(docs > 0) mapDocs.set(String(c.caixa).trim().toLowerCase(), docs);
            });
        }

        try {
            try {
                const hAv = await pastaHandle.getFileHandle("caixas_avulsas.json", { create: false });
                absorverLista(JSON.parse(await (await hAv.getFile()).text() || "[]"));
            } catch(e) {}
            try {
                const hEl = await pastaHandle.getFileHandle("caixas_eliminadas.json", { create: false });
                absorverLista(JSON.parse(await (await hEl.getFile()).text() || "[]"));
            } catch(e) {}

            const prateleirasUnicas = new Set(
                (db.caixas || []).filter(c => c.prateleira && String(c.prateleira).trim()).map(c => c.prateleira.trim())
            );
            const subFolder = await pastaHandle.getDirectoryHandle("caixas_prateleiras", { create: false });
            for(const pNome of prateleirasUnicas){
                try {
                    const hP = await subFolder.getFileHandle(`prateleira_${pNome}.json`, { create: false });
                    absorverLista(JSON.parse(await (await hP.getFile()).text() || "[]"));
                } catch(e) {}
            }

            let alterou = false;
            db.caixas.forEach(c => {
                if(c.documentos === undefined || c.documentos === null){
                    const chave = String(c.caixa).trim().toLowerCase();
                    const docs = mapDocs.has(chave) ? mapDocs.get(chave) : 0;
                    if(c.documentos !== docs){ c.documentos = docs; alterou = true; }
                }
            });

            if(alterou){
                const fileIndexHandle = await pastaHandle.getFileHandle("caixas_index.json", { create: true });
                const writableIndex = await fileIndexHandle.createWritable();
                await writableIndex.write(JSON.stringify(db.caixas));
                await writableIndex.close();
                const fileIndexNew = await fileIndexHandle.getFile();
                indexMetadata.size = fileIndexNew.size;
                indexMetadata.lastModified = fileIndexNew.lastModified;
                await salvarIndexNoCache(db.caixas, fileIndexNew.size, fileIndexNew.lastModified);
            }
        } catch(e){
            console.warn("Sincronização de documentos no índice:", e);
        }
        _documentosIndiceSincronizado = true;
    }


    async function carregarDB(silencioso = false){
        if(!pastaHandle) return;
        const mostrarLoad = !silencioso;
        if(mostrarLoad) mostrarCarregamento("Carregando dados…");
        try{
            let oldDbFile = null;
            try {
                oldDbFile = await pastaHandle.getFileHandle("banco_erp.json", { create: false });
            } catch(e) {}
            if (oldDbFile) {
                const slSync = document.getElementById("syncLabel");
                if(slSync) slSync.innerText = "Migrando banco...";
                await migrarBancoDadosSeNecessario(pastaHandle);
            }

            const fileConfigHandle = await pastaHandle.getFileHandle("config_erp.json", { create: true });
            const fileConfig = await fileConfigHandle.getFile();
            
            if (fileConfig.size !== configMetadata.size || fileConfig.lastModified !== configMetadata.lastModified) {
                const text = await fileConfig.text();
                const configParsed = text ? JSON.parse(text) : { prateleiras: [], processos: [], unidades: [], responsaveis: [], relacoes: [] };
                
                db.prateleiras = configParsed.prateleiras || [];
                db.processos = configParsed.processos || [];
                db.unidades = configParsed.unidades || [];
                db.responsaveis = configParsed.responsaveis || [];
                // Deduplicar relações para remover duplicatas que podem ter sido geradas pelo bug anterior
                const dedupRelacoes = [];
                const idsRelMap = new Set();
                (configParsed.relacoes || []).forEach(r => {
                    if (!idsRelMap.has(r.id)) {
                        idsRelMap.add(r.id);
                        dedupRelacoes.push(r);
                    }
                });
                db.relacoes = dedupRelacoes;
                
                // Auto-recuperação de relações antigas (do backup do banco monolithic)
                try {
                    const hBackup = await pastaHandle.getFileHandle("banco_erp_backup.json", { create: false });
                    const backupFile = await hBackup.getFile();
                    const backupDb = JSON.parse(await backupFile.text());
                    if (backupDb && backupDb.relacoes) {
                        let resgatadas = false;
                        backupDb.relacoes.forEach(oldRel => {
                            if (!db.relacoes.some(r => r.id === oldRel.id)) {
                                db.relacoes.push(oldRel);
                                resgatadas = true;
                            }
                        });
                        if (resgatadas) {
                            // Reordena para ficar cronológico (as mais recentes no final ou as antigas primeiro, depois no render inverte)
                            db.relacoes.sort((a,b) => new Date(a.dataISO) - new Date(b.dataISO));
                            // Vamos regravar o config file para salvar essas resgatadas de vez (fora do ciclo read-only)
                            setTimeout(() => salvarDB({ config: true, semOverlay: true }), 2000);
                        }
                    }
                } catch(e) { }

                configMetadata.size = fileConfig.size;
                configMetadata.lastModified = fileConfig.lastModified;
            }

            const fileIndexHandle = await pastaHandle.getFileHandle("caixas_index.json", { create: true });
            const fileIndex = await fileIndexHandle.getFile();

            if (fileIndex.size !== indexMetadata.size || fileIndex.lastModified !== indexMetadata.lastModified) {
                const cached = await lerIndexDoCache();
                if (cached && cached.meta.size === fileIndex.size && cached.meta.lastModified === fileIndex.lastModified) {
                    db.caixas = cached.list || [];
                } else {
                    const text = await fileIndex.text();
                    db.caixas = text ? JSON.parse(text) : [];
                    await salvarIndexNoCache(db.caixas, fileIndex.size, fileIndex.lastModified);
                }
                
                indexMetadata.size = fileIndex.size;
                indexMetadata.lastModified = fileIndex.lastModified;
                
                db.responsaveis.forEach(r => {
                    if (r.funcao === "Preparada") r.funcao = "Preparador";
                    else if (r.funcao === "Digitalizada") r.funcao = "Digitalizador";
                    else if (["Guardada", "Avulsa", "Eliminada"].includes(r.funcao)) r.funcao = "";
                });
                
                garantirHistoricoCaixas();
                normalizarEliminadasELocaisAvulsos();
                rebuildCaixaIndexMap();
                await sincronizarDocumentosIndiceSeNecessario();
                rebuildCaixaIndexMap();
                atualizarInterface();
                const slSync = document.getElementById("syncLabel");
                if(slSync) slSync.innerText = "Sinc.: " + new Date().toLocaleTimeString();
                if(window.ERP_PAGE_ID === "lancamento") aplicarEdicaoSeNecessario();
            }
        }catch(err){ console.error(err); }
        finally {
            if(mostrarLoad) esconderCarregamento();
        }
    }

    async function salvarDB(opcoes = {}){
        let lockClientId = null;
        if(!opcoes.semOverlay) mostrarCarregamento(opcoes.msgCarregamento || "Salvando dados…");
        try {
            let userName = "Sistema";
            try {
                const uStr = sessionStorage.getItem("usuarioLogado");
                const u = uStr ? JSON.parse(uStr) : null;
                userName = (u && u.nome) ? u.nome : "Sistema";
            } catch(e) {}

            lockClientId = await acquireLock(userName);

            if (opcoes.config) {
                const configParsed = {
                    prateleiras: db.prateleiras,
                    processos: db.processos,
                    unidades: db.unidades,
                    responsaveis: db.responsaveis,
                    relacoes: db.relacoes || []
                };

                const fileConfigHandle = await pastaHandle.getFileHandle("config_erp.json", { create: true });
                const writableConfig = await fileConfigHandle.createWritable();
                await writableConfig.write(JSON.stringify(configParsed, null, 2));
                await writableConfig.close();
                
                const fileConfigNew = await fileConfigHandle.getFile();
                configMetadata.size = fileConfigNew.size;
                configMetadata.lastModified = fileConfigNew.lastModified;
            }

            if (opcoes.caixas || opcoes.removerCaixas) {
                const fileIndexHandle = await pastaHandle.getFileHandle("caixas_index.json", { create: true });
                const fileIndex = await fileIndexHandle.getFile();
                const text = await fileIndex.text();
                const indexList = text ? JSON.parse(text) : [];
                const indexMap = new Map(indexList.map((x, i) => [String(x.caixa).trim().toLowerCase(), i]));

                const subFolder = await pastaHandle.getDirectoryHandle("caixas_prateleiras", { create: true });
                
                const prateleirasCarregadas = {};
                const prateleirasDirty = new Set();
                let avulsasCarregadas = null;
                let avulsasDirty = false;
                let eliminadasCarregadas = null;
                let eliminadasDirty = false;

                async function obterListaDestino(prateleira, status) {
                    if (status === "Eliminada") {
                        if (eliminadasCarregadas === null) {
                            const fileH = await pastaHandle.getFileHandle("caixas_eliminadas.json", { create: true });
                            const file = await fileH.getFile();
                            const txt = await file.text();
                            eliminadasCarregadas = txt ? JSON.parse(txt) : [];
                        }
                        return eliminadasCarregadas;
                    } else if (!prateleira || !prateleira.trim()) {
                        if (avulsasCarregadas === null) {
                            const fileH = await pastaHandle.getFileHandle("caixas_avulsas.json", { create: true });
                            const file = await fileH.getFile();
                            const txt = await file.text();
                            avulsasCarregadas = txt ? JSON.parse(txt) : [];
                        }
                        return avulsasCarregadas;
                    } else {
                        const pNome = prateleira.trim();
                        if (!prateleirasCarregadas[pNome]) {
                            let listP = [];
                            try {
                                const fileH = await subFolder.getFileHandle(`prateleira_${pNome}.json`, { create: false });
                                const file = await fileH.getFile();
                                const txt = await file.text();
                                listP = txt ? JSON.parse(txt) : [];
                            } catch (e) {}
                            prateleirasCarregadas[pNome] = listP;
                        }
                        return prateleirasCarregadas[pNome];
                    }
                }

                function marcarDirty(prateleira, status){
                    if(status === "Eliminada") eliminadasDirty = true;
                    else if(!prateleira || !String(prateleira).trim()) avulsasDirty = true;
                    else prateleirasDirty.add(String(prateleira).trim());
                }

                if (opcoes.removerCaixas) {
                    for (let cShort of opcoes.removerCaixas) {
                        const cNome = String(cShort.caixa).trim().toLowerCase();
                        const idxIdx = indexMap.has(cNome) ? indexMap.get(cNome) : -1;
                        if (idxIdx !== -1) {
                            indexList.splice(idxIdx, 1);
                            indexMap.delete(cNome);
                            indexList.forEach((x, i) => indexMap.set(String(x.caixa).trim().toLowerCase(), i));
                        }

                        const listDest = await obterListaDestino(cShort.prateleira, cShort.status);
                        const idxDest = listDest.findIndex(x => String(x.caixa).trim().toLowerCase() === cNome);
                        if (idxDest !== -1) {
                            listDest.splice(idxDest, 1);
                            marcarDirty(cShort.prateleira, cShort.status);
                        }
                    }
                }

                if (opcoes.caixas) {
                    for (let cFull of opcoes.caixas) {
                        const cNome = String(cFull.caixa).trim().toLowerCase();
                        const idxIdx = indexMap.has(cNome) ? indexMap.get(cNome) : -1;
                        let oldShort = idxIdx !== -1 ? indexList[idxIdx] : null;

                        if (oldShort && (oldShort.prateleira !== cFull.prateleira || oldShort.status !== cFull.status)) {
                            const listAntiga = await obterListaDestino(oldShort.prateleira, oldShort.status);
                            const idxAntigo = listAntiga.findIndex(x => String(x.caixa).trim().toLowerCase() === cNome);
                            if (idxAntigo !== -1) {
                                listAntiga.splice(idxAntigo, 1);
                                marcarDirty(oldShort.prateleira, oldShort.status);
                            }
                        }

                        const listNova = await obterListaDestino(cFull.prateleira, cFull.status);
                        const idxNova = listNova.findIndex(x => String(x.caixa).trim().toLowerCase() === cNome);
                        if (idxNova !== -1) {
                            listNova[idxNova] = cFull;
                        } else {
                            listNova.push(cFull);
                        }
                        marcarDirty(cFull.prateleira, cFull.status);

                        const shortItem = criarShortItem(cFull);

                        if (idxIdx !== -1) {
                            indexList[idxIdx] = shortItem;
                        } else {
                            indexList.push(shortItem);
                            indexMap.set(cNome, indexList.length - 1);
                        }
                    }
                }

                for (let pNome of prateleirasDirty) {
                    if (!prateleirasCarregadas[pNome]) continue;
                    const fileH = await subFolder.getFileHandle(`prateleira_${pNome}.json`, { create: true });
                    const writable = await fileH.createWritable();
                    await writable.write(JSON.stringify(prateleirasCarregadas[pNome]));
                    await writable.close();
                }

                if (avulsasDirty && avulsasCarregadas !== null) {
                    const fileH = await pastaHandle.getFileHandle("caixas_avulsas.json", { create: true });
                    const writable = await fileH.createWritable();
                    await writable.write(JSON.stringify(avulsasCarregadas));
                    await writable.close();
                }

                if (eliminadasDirty && eliminadasCarregadas !== null) {
                    const fileH = await pastaHandle.getFileHandle("caixas_eliminadas.json", { create: true });
                    const writable = await fileH.createWritable();
                    await writable.write(JSON.stringify(eliminadasCarregadas));
                    await writable.close();
                }

                const writableIndex = await fileIndexHandle.createWritable();
                await writableIndex.write(JSON.stringify(indexList));
                await writableIndex.close();

                const fileIndexNew = await fileIndexHandle.getFile();
                db.caixas = indexList;
                indexMetadata.size = fileIndexNew.size;
                indexMetadata.lastModified = fileIndexNew.lastModified;
                rebuildCaixaIndexMap();
                await salvarIndexNoCache(db.caixas, fileIndexNew.size, fileIndexNew.lastModified);
            }
        } finally {
            if (lockClientId) {
                await releaseLock(lockClientId);
            }
            if(!opcoes.semOverlay) esconderCarregamento();
        }
    }


    // ---------------- GESTÃO DE PRATELEIRAS ----------------
    async function adicionarPrateleira(){
        const nome = document.getElementById("nomePrateleiraNova").value.trim();
        if(!nome) return;
        if(db.prateleiras.find(p => p.nome === nome)) return alert("Prateleira já existe!");
        db.prateleiras.push({ nome: nome, capacidade: 78 });
        await salvarDB({ config: true });
        document.getElementById("nomePrateleiraNova").value = "";
        atualizarInterface();
    }

    async function excluirPrateleira(nome){
        if(db.caixas.some(c => caixaOcupaSlot(c) && c.prateleira === nome)) return alert("Não é possível excluir: há caixas alocadas nesta prateleira!");
        if(confirm(`Excluir prateleira ${nome}?`)){
            db.prateleiras = db.prateleiras.filter(p => p.nome !== nome);
            await salvarDB({ config: true });
            atualizarInterface();
        }
    }

    // ---------------- GESTÃO DE PROCESSOS ----------------
    async function adicionarProcesso(){
        const nome = document.getElementById("nomeProcessoNovo").value.trim();
        if(!nome) return;
        if(db.processos.includes(nome)) return alert("Processo já existe!");
        db.processos.push(nome);
        await salvarDB({ config: true });
        document.getElementById("nomeProcessoNovo").value = "";
        atualizarInterface();
    }

    async function excluirProcesso(nome){
        if(db.caixas.some(c => c.processos && c.processos.includes(nome)))
            return alert("Não é possível excluir: existem caixas vinculadas a este processo!");
        if(confirm(`Excluir processo ${nome}?`)){
            db.processos = db.processos.filter(p => p !== nome);
            await salvarDB({ config: true });
            atualizarInterface();
        }
    }

    // ---------------- GESTÃO DE UNIDADES (NOVO) ----------------
    async function adicionarUnidade(){
        if(!db.unidades) db.unidades = [];
        
        const elNum = document.getElementById("numeroUnidadeNova");
        const elNome = document.getElementById("nomeUnidadeNova");

        if(!elNum || !elNome) return alert("Erro: Elementos de número ou nome da unidade não encontrados no HTML.");

        const numero = elNum.value.trim();
        const nome = elNome.value.trim();
        if(!numero || !nome) return alert("Preencha o número e o nome da unidade!");

        // Verifica se a unidade já existe (seja no formato velho ou no formato novo de objetos)
        const jaExiste = db.unidades.some(u => {
            if(typeof u === 'string') return u.toLowerCase() === nome.toLowerCase();
            return u.numero === numero || u.nome.toLowerCase() === nome.toLowerCase();
        });

        if(jaExiste) return alert("Esta unidade (número ou nome) já existe!");

        db.unidades.push({ numero: numero, nome: nome });
        await salvarDB({ config: true });
        elNum.value = "";
        elNome.value = "";
        atualizarInterface();
    }

    async function excluirUnidade(identificador){
        // Identificador pode ser o NÚMERO (novo) ou o NOME (legado)
        if(db.caixas.some(c => c.unidade && c.unidade.includes(identificador)))
            return alert("Não é possível excluir: existem caixas vinculadas a esta unidade!");
            
        if(confirm(`Excluir esta unidade?`)){
            db.unidades = db.unidades.filter(u => {
                if(typeof u === 'string') return u !== identificador;
                return u.numero !== identificador && u.nome !== identificador;
            });
            await salvarDB({ config: true });
            atualizarInterface();
        }
    }

    // ---------------- GESTÃO DE RESPONSÁVEIS ----------------
    function toggleCamposDigitalizador(funcao, login = '', usuario = '', senha = '') {
        const divCampos = document.getElementById("camposDigitalizador");
        if (divCampos) {
            const needsLogin = ['Digitalizador', 'Preparador Chefe', 'Administrador'].includes(funcao);
            divCampos.style.display = needsLogin ? 'flex' : 'none';
            if (needsLogin) {
                document.getElementById("loginRespNovo").value = login;
                document.getElementById("usuarioRespNovo").value = usuario;
                document.getElementById("senhaRespNovo").value = senha;
            } else {
                if(document.getElementById("loginRespNovo")) document.getElementById("loginRespNovo").value = "";
                if(document.getElementById("usuarioRespNovo")) document.getElementById("usuarioRespNovo").value = "";
                if(document.getElementById("senhaRespNovo")) document.getElementById("senhaRespNovo").value = "";
            }
        }
    }

    async function adicionarResponsavel(){
        if(!db.responsaveis) db.responsaveis = [];

        const elNome = document.getElementById("nomeRespNovo");
        const elApelido = document.getElementById("apelidoRespNovo");
        const elFuncao = document.getElementById("funcaoRespNova");

        if(!elNome || !elApelido || !elFuncao) return alert("Erro: Elementos do responsável não encontrados.");

        const nome = elNome.value.trim();
        const apelido = elApelido.value.trim();
        const funcao = elFuncao.value;

        if(!nome || !apelido) return alert("Preencha o nome completo e o apelido do responsável!");

        const elLogin = document.getElementById("loginRespNovo");
        const elUsuario = document.getElementById("usuarioRespNovo");
        const elSenha = document.getElementById("senhaRespNovo");
        
        let login = "";
        let usuario = "";
        let senha = "";
        
        if (['Digitalizador', 'Preparador Chefe', 'Administrador'].includes(funcao)) {
            login = elLogin ? elLogin.value.trim() : "";
            usuario = elUsuario ? elUsuario.value.trim() : "";
            senha = elSenha ? elSenha.value.trim() : "";
            
            if (!login || !usuario || !senha) {
                return alert("Preencha login, usuário e senha para esta função!");
            }
        }

        const jaExiste = db.responsaveis.some(r => (r.nome.toLowerCase() === nome.toLowerCase() || r.apelido.toLowerCase() === apelido.toLowerCase()));
        if(jaExiste) return alert("Este responsável (nome ou apelido) já existe!");

        db.responsaveis.push({ nome, apelido, funcao, login, usuario, senha });

        await salvarDB({ config: true });
        
        elNome.value = "";
        elApelido.value = "";
        elFuncao.value = "";
        toggleCamposDigitalizador(""); // Reseta os campos
        atualizarInterface();
    }

    function editarResponsavel(nome) {
        const resp = db.responsaveis.find(r => r.nome === nome);
        if (!resp) return;

        const needsLogin = ['Digitalizador', 'Preparador Chefe', 'Administrador'].includes(resp.funcao);

        const htmlCorpo = `
            <h2 style="margin-top:0; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 20px;">✏️ Editar Responsável</h2>
            <div class="card" style="box-shadow:none; padding:0; background: transparent;">
                <input type="hidden" id="nomeRespEditandoModal" value="${escModal(resp.nome)}">
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">Nome Completo</label>
                    <input type="text" id="nomeRespEdit" value="${escModal(resp.nome)}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
                </div>
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">Apelido</label>
                    <input type="text" id="apelidoRespEdit" value="${escModal(resp.apelido)}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
                </div>
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">Função</label>
                    <select id="funcaoRespEdit" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" onchange="document.getElementById('camposDigitalizadorEdit').style.display = ['Digitalizador', 'Preparador Chefe', 'Administrador'].includes(this.value) ? 'flex' : 'none'">
                        <option value="" ${!resp.funcao ? 'selected' : ''}>— Função —</option>
                        <option value="Preparador" ${resp.funcao === 'Preparador' ? 'selected' : ''}>Preparador</option>
                        <option value="Preparador Chefe" ${resp.funcao === 'Preparador Chefe' ? 'selected' : ''}>Preparador Chefe</option>
                        <option value="Digitalizador" ${resp.funcao === 'Digitalizador' ? 'selected' : ''}>Digitalizador</option>
                        <option value="Administrador" ${resp.funcao === 'Administrador' ? 'selected' : ''}>Administrador</option>
                    </select>
                </div>
                
                <div id="camposDigitalizadorEdit" style="display: ${needsLogin ? 'flex' : 'none'}; flex-direction: column; gap: 15px; margin-bottom: 20px; padding: 15px; background-color: #f9f9f9; border-radius: 6px; border: 1px solid #eee;">
                    <h4 style="margin: 0 0 5px 0; color: #333;">Acesso ao Sistema</h4>
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">Login</label>
                        <input type="text" id="loginRespEdit" value="${escModal(resp.login || '')}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">Usuário</label>
                        <input type="text" id="usuarioRespEdit" value="${escModal(resp.usuario || '')}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">Senha</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <input type="password" id="senhaRespEdit" value="${escModal(resp.senha || '')}" style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
                            <button type="button" class="btn-sec" onclick="const p = document.getElementById('senhaRespEdit'); p.type = p.type === 'password' ? 'text' : 'password';" style="padding: 8px 12px; margin: 0; white-space: nowrap;" title="Mostrar/Ocultar Senha">👁️</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        abrirModal(htmlCorpo, {
            wide: true,
            footer: '<button type="button" class="btn-sec" onclick="fecharModal()">Cancelar</button><button type="button" class="btn-prim" onclick="salvarEdicaoResponsavelModal()">Salvar Alterações</button>'
        });
    }

    async function salvarEdicaoResponsavelModal() {
        const nomeAntigo = document.getElementById("nomeRespEditandoModal").value;
        const nome = document.getElementById("nomeRespEdit").value.trim();
        const apelido = document.getElementById("apelidoRespEdit").value.trim();
        const funcao = document.getElementById("funcaoRespEdit").value;
        
        if(!nome || !apelido) return alert("Preencha o nome completo e o apelido do responsável!");
        
        let login = "";
        let usuario = "";
        let senha = "";
        
        if (['Digitalizador', 'Preparador Chefe', 'Administrador'].includes(funcao)) {
            login = document.getElementById("loginRespEdit").value.trim();
            usuario = document.getElementById("usuarioRespEdit").value.trim();
            senha = document.getElementById("senhaRespEdit").value.trim();
            if (!login || !usuario || !senha) return alert("Preencha login, usuário e senha para esta função!");
        }

        const jaExiste = db.responsaveis.some(r => (r.nome.toLowerCase() === nome.toLowerCase() || r.apelido.toLowerCase() === apelido.toLowerCase()) && r.nome !== nomeAntigo);
        if(jaExiste) return alert("Este responsável (nome ou apelido) já existe!");

        const index = db.responsaveis.findIndex(r => r.nome === nomeAntigo);
        if (index !== -1) {
            db.responsaveis[index] = { nome, apelido, funcao, login, usuario, senha };
            
            if (db.caixas && nome !== nomeAntigo) {
                db.caixas.forEach(c => {
                    if (c.usuario === nomeAntigo) c.usuario = nome;
                    else if (c.usuario && c.usuario.includes(nomeAntigo)) c.usuario = c.usuario.replace(nomeAntigo, nome);
                });
            }
        }
        
        await salvarDB({ config: true });
        fecharModal();
        atualizarInterface();
    }

    function cancelarEdicaoResponsavel() {
        document.getElementById("nomeRespNovo").value = "";
        document.getElementById("apelidoRespNovo").value = "";
        document.getElementById("funcaoRespNova").value = "";
        document.getElementById("nomeRespEditando").value = "";
        
        toggleCamposDigitalizador("");
        
        document.getElementById("btnCadastrarResponsavel").innerText = "Cadastrar responsável";
        document.getElementById("btnCancelarEdicao").style.display = "none";
    }

    async function excluirResponsavel(nome){
        if(db.caixas.some(c => c.usuario && (c.usuario === nome || c.usuario.includes(nome))))
            return alert("Não é possível excluir: existem caixas vinculadas a este responsável!");

        if(confirm(`Excluir o responsável ${nome}?`)){
            db.responsaveis = db.responsaveis.filter(r => r.nome !== nome && r.apelido !== nome);
            await salvarDB({ config: true });
            atualizarInterface();
        }
    }

    function renderConfigResponsaveis(){
        const lista = document.getElementById("listaResponsaveisConfig");
        if(!lista) return;
        lista.innerHTML = "";
        (db.responsaveis || []).forEach(r => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escModal(r.nome)}</td>
                <td>${escModal(r.apelido)}</td>
                <td>${escModal(r.funcao || "—")}</td>
                <td class="td-acoes">
                    <button class="btn-editar" onclick="editarResponsavel('${escModal(r.nome)}')">✏️ Editar</button>
                    <button class="btn-excluir" onclick="excluirResponsavel('${escModal(r.nome)}')">🗑️ Excluir</button>
                </td>
            `;
            lista.appendChild(tr);
        });
    }

    // ---------------- INTERFACE ----------------
    function atualizarInterface(){
        verificarAutenticacao();
        if (ERP_PAGE_ID === "login") {
            atualizarTelaLogin();
        }

        renderSelectPrateleiras();
        renderSelectUnidades();
        renderCheckboxesProcessos();
        renderConfigProcessos();
        renderConfigUnidades();
        renderConfigPrateleiras();
        renderConfigResponsaveis();
        preencherFiltrosListaCaixas();
        listar();
        if(document.getElementById("dashboardKpis")) atualizarDashboard();
        if(document.getElementById("listaAvulsas")) renderAvulsas();
        if(document.getElementById("mapaLancamento")) renderMapaLancamento();
        if(document.getElementById("mapa")) mapa();
        if(ERP_PAGE_ID === "preparacao") atualizarTelaPreparacao();
        if(ERP_PAGE_ID === "digitalizacao") atualizarTelaDigitalizacao();
        if(ERP_PAGE_ID === "relacao") atualizarTelaRelacao();
        atualizarOpcoesResponsavel();
        atualizarOpcoesResponsavelLista();
        if(ERP_PAGE_ID === "importar") atualizarTelaImportacao();
    }

    function renderSelectPrateleiras(){
        const sel = document.getElementById("prateleiraSelect");
        if(!sel) return;
        const valorAtual = sel.value;
        sel.innerHTML = '<option value="">— Caixa avulsa (sem prateleira) —</option>';
        
        // Calcula ocupação de todas as prateleiras uma única vez
        const ocupacao = calcularOcupacaoPrateleiras();
        
        db.prateleiras.forEach(p => {
            const capacidade = p.capacidade || 78;
            const ocupados = ocupacao.get(p.nome) || 0;
            // Filtra prateleiras que ainda têm espaço
            if(ocupados < capacidade){
                const opt = document.createElement("option");
                opt.value = p.nome; opt.text = p.nome;
                sel.appendChild(opt);
            }
        });
        if([...sel.options].some(o => o.value === valorAtual)) sel.value = valorAtual;
        const st = document.getElementById("status") && document.getElementById("status").value;
        sel.disabled = st === "Eliminada";
    }

    function renderSelectUnidades(){
        const sel = document.getElementById("unidadeSelect");
        if(!sel) return;
        const valorAtual = sel.value;
        sel.innerHTML = '<option value="">— Não informada —</option>';
        
        // Mapeia as unidades (novas e velhas) para uma lista de Strings formatadas
        let opcoesFormatadas = (db.unidades || []).map(u => {
            if (typeof u === 'string') return u; // Dado antigo
            return `${u.numero} - ${u.nome}`; // Dado novo
        });
        
        // Ordena em ordem alfabética
        opcoesFormatadas.sort((a, b) => a.localeCompare(b, "pt")).forEach(u => {
            const opt = document.createElement("option");
            opt.value = u;
            opt.textContent = u;
            sel.appendChild(opt);
        });

        if(valorAtual && ![...sel.options].some(o => o.value === valorAtual)){
            const opt = document.createElement("option");
            opt.value = valorAtual;
            opt.textContent = valorAtual + " (cadastre em Unidades)";
            sel.appendChild(opt);
        }
        if([...sel.options].some(o => o.value === valorAtual)) sel.value = valorAtual;
    }

    function renderConfigUnidades(){
        const tbody = document.getElementById("listaUnidadesConfig");
        if(!tbody) return;
        tbody.innerHTML = "";
        
        (db.unidades || []).forEach(u => {
            // Retrocompatibilidade: Se for string, mostra traço no número
            if (typeof u === 'string') {
                tbody.innerHTML += `<tr><td>—</td><td><b>${escModal(u)}</b></td><td><button type="button" style="background:#e74c3c" onclick="excluirUnidade('${u}')">Excluir</button></td></tr>`;
            } else {
                tbody.innerHTML += `<tr><td>${escModal(u.numero)}</td><td><b>${escModal(u.nome)}</b></td><td><button type="button" style="background:#e74c3c" onclick="excluirUnidade('${u.numero}')">Excluir</button></td></tr>`;
            }
        });
    }

    function renderCheckboxesProcessos(){
        const container = document.getElementById("processosContainer");
        if(!container) return;
        container.innerHTML = db.processos.length === 0 ? "<small>Nenhum processo cadastrado</small>" : "";
        db.processos.forEach(proc => {
            container.innerHTML += `<label style="font-size:13px; cursor:pointer;"><input type="checkbox" name="procCheck" value="${proc}"> ${proc}</label>`;
        });
    }

    function renderConfigProcessos(){
        const tbody = document.getElementById("listaProcessosConfig");
        if(!tbody) return;
        tbody.innerHTML = "";
        db.processos.forEach(p => {
            tbody.innerHTML += `<tr><td>${p}</td><td><button style="background:#e74c3c" onclick="excluirProcesso('${p}')">Excluir</button></td></tr>`;
        });
    }

    function renderConfigPrateleiras(){
        const tbody = document.getElementById("listaPrateleirasConfig");
        if(!tbody) return;

        // 1. Lógica de Busca (Filtro por nome)
        const buscaEl = document.getElementById("buscarPratConfig");
        const busca = (buscaEl ? buscaEl.value : "").toLowerCase().trim();

        let filtradas = db.prateleiras;
        if(busca) {
            filtradas = filtradas.filter(p => p.nome.toLowerCase().includes(busca));
        }

        // 2. Lógica de Paginação
        const totalItens = filtradas.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPaginaConfigPrat) || 1;
        
        if(paginaAtualConfigPrat > totalPaginas) paginaAtualConfigPrat = totalPaginas;
        if(paginaAtualConfigPrat < 1) paginaAtualConfigPrat = 1;

        const inicio = (paginaAtualConfigPrat - 1) * itensPorPaginaConfigPrat;
        const fim = inicio + itensPorPaginaConfigPrat;
        const prateleirasPagina = filtradas.slice(inicio, fim);

        // 3. OTIMIZAÇÃO EXTREMA: Conta as caixas de TODAS as prateleiras da página de UMA SÓ VEZ
        const contagemOcupacao = new Map();
        prateleirasPagina.forEach(p => contagemOcupacao.set(p.nome, 0));

        // Varre os 200 mil registros apenas 1 vez (instantâneo)
        db.caixas.forEach(c => {
            if(caixaOcupaSlot(c) && contagemOcupacao.has(c.prateleira)) {
                contagemOcupacao.set(c.prateleira, contagemOcupacao.get(c.prateleira) + 1);
            }
        });

        // 4. Renderiza a tabela
        tbody.innerHTML = "";
        if (totalItens === 0) {
            tbody.innerHTML = "<tr><td colspan='3' style='padding:20px; color:#7f8c8d;'>Nenhuma prateleira encontrada.</td></tr>";
        } else {
            prateleirasPagina.forEach(p => {
                const qtd = contagemOcupacao.get(p.nome) || 0;
                tbody.innerHTML += `<tr>
                    <td><b>${p.nome}</b></td>
                    <td>${qtd} / ${p.capacidade || 78}</td>
                    <td class="td-acoes">
                        <button class="btn-excluir" onclick="excluirPrateleira('${p.nome}')">🗑️ Excluir</button>
                    </td>
                </tr>`;
            });
        }

        // 5. Renderiza a barra de paginação
        renderizarPaginacaoConfigPrat(totalItens, totalPaginas);
    }

    // ---------------- HISTÓRICO DE CAIXAS ----------------
    function garantirHistoricoCaixas(){
        // Não é mais necessário varrer todas as caixas do índice
    }

    function normalizarEliminadasELocaisAvulsos(){
        // Não é mais necessário varrer todas as caixas do índice
    }

    function caixaOcupaSlot(c){
        if(!c || c.status === "Eliminada" || c.status === "Avulsa") return false;
        if(!c.prateleira || !String(c.prateleira).trim()) return false;
        const n = parseInt(c.nivel, 10), e = parseInt(c.espaco, 10);
        return !isNaN(n) && !isNaN(e) && n >= 1 && n <= 13 && e >= 1 && e <= 6;
    }

    let _cacheOcupacaoPrateleiras = null;
    let _cacheHashCaixas = "";

    function calcularOcupacaoPrateleiras(){
        // Calcula a ocupação de todas as prateleiras em uma única passagem
        const ocupacao = new Map();
        db.caixas.forEach(c => {
            if(caixaOcupaSlot(c)){
                ocupacao.set(c.prateleira, (ocupacao.get(c.prateleira) || 0) + 1);
            }
        });
        return ocupacao;
    }

    function verificarSeEstaCheia(nomePrateleira){
        if(!nomePrateleira) return false;
        
        // Se o cache está inválido, recalcula
        const hashAtual = JSON.stringify(db.caixas.length);
        if(_cacheHashCaixas !== hashAtual){
            _cacheOcupacaoPrateleiras = calcularOcupacaoPrateleiras();
            _cacheHashCaixas = hashAtual;
        }
        
        const prateleira = db.prateleiras.find(p => p.nome === nomePrateleira);
        if(!prateleira) return false;
        const capacidade = prateleira.capacidade || 78;
        const ocupados = _cacheOcupacaoPrateleiras.get(nomePrateleira) || 0;
        return ocupados >= capacidade;
    }

    function formatarLocalCaixa(c){
        if(!c) return "—";
        if(c.status === "Eliminada") return "Eliminada (sem prateleira)";
        if(!c.prateleira || !String(c.prateleira).trim()) return "Avulsa (sem prateleira)";
        
        // NOVO FORMATO DE ENDEREÇO MAIS CLARO
        return `Prateleira ${c.prateleira} • Nível ${c.nivel} • Espaço ${c.espaco}`;
    }

    function processosChave(arr){
        return JSON.stringify([...(arr || [])].slice().sort());
    }

    function snapshotCaixaParaHistorico(c){
        return {
            caixa: c.caixa,
            unidade: c.unidade || "",
            inicio: c.inicio || "",
            fim: c.fim || "",
            validade: c.validade || "",
            prateleira: c.prateleira || "",
            nivel: c.nivel,
            espaco: c.espaco,
            status: c.status || "",
            usuario: c.usuario || "",
            processos: c.processos ? [...c.processos] : []
        };
    }

    function extrairMudancasRegistro(antes, depois){
        const m = [];
        const rotulos = { caixa: "Número da caixa", unidade: "Unidade", inicio: "Data início", fim: "Data fim", validade: "Validade", status: "Status", usuario: "Responsável" };
        for(const k of ["caixa", "unidade", "inicio", "fim", "validade", "status", "usuario"]){
            const va = antes[k] != null ? String(antes[k]) : "";
            const vb = depois[k] != null ? String(depois[k]) : "";
            if(va !== vb) m.push({ campo: k, label: rotulos[k], de: va || "—", para: vb || "—" });
        }
        if(formatarLocalCaixa(antes) !== formatarLocalCaixa(depois))
            m.push({ campo: "localizacao", label: "Localização", de: formatarLocalCaixa(antes), para: formatarLocalCaixa(depois) });
        if(processosChave(antes.processos) !== processosChave(depois.processos)){
            const fa = (antes.processos && antes.processos.length) ? antes.processos.join(", ") : "—";
            const fb = (depois.processos && depois.processos.length) ? depois.processos.join(", ") : "—";
            m.push({ campo: "processos", label: "Processos", de: fa, para: fb });
        }
        return m;
    }

    function criarEntradaHistorico(tipo, mudancas, registradoPor){
        return {
            quandoISO: new Date().toISOString(),
            tipo: tipo,
            registradoPor: registradoPor != null ? String(registradoPor) : "",
            mudancas: mudancas
        };
    }

    function mudancasIniciaisCadastro(depois){
        return extrairMudancasRegistro({
            caixa: "", unidade: "", inicio: "", fim: "", validade: "", prateleira: "", nivel: 0, espaco: 0,
            status: "", usuario: "", processos: []
        }, depois);
    }

    function escModal(s){
        if(s == null || s === "") return "";
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function renderHtmlHistorico(caixa){
        const lista = Array.isArray(caixa.historico) ? [...caixa.historico].reverse() : [];
        if(lista.length === 0)
            return "<div class=\"historico-vazio\">Nenhum evento registrado (caixa antiga ou sem alterações desde a atualização).</div>";
        return lista.map(h => {
            const dataStr = h.quandoISO ? new Date(h.quandoISO).toLocaleString("pt-BR") : "—";
            const tipoTxt = h.tipo === "criacao" ? "Cadastro" : "Edição";
            const por = h.registradoPor ? " · Responsável no formulário: " + escModal(h.registradoPor) : "";
            const mhtml = (h.mudancas || []).map(mu =>
                "<div class=\"historico-mud\"><strong>" + escModal(mu.label) + ":</strong> " +
                escModal(mu.de) + " → " + escModal(mu.para) + "</div>"
            ).join("");
            return "<div class=\"historico-item\"><div class=\"hi-top\">" + escModal(dataStr) + por +
                "</div><div class=\"hi-tipo\">" + tipoTxt + "</div>" + mhtml + "</div>";
        }).join("");
    }

    // ---------------- CRUD CAIXAS ----------------
    function atualizarResumoPosicao(){
        const el = document.getElementById("posicaoLancamentoResumo");
        if(!el) return;
        const st = document.getElementById("status") && document.getElementById("status").value;
        if(st === "Eliminada"){
            el.textContent = "Sem local físico — caixa eliminada não fica em prateleira.";
            el.classList.add("vazio");
            return;
        }
        const prat = document.getElementById("prateleiraSelect") && document.getElementById("prateleiraSelect").value;
        if(!prat){
            el.textContent = "Caixa avulsa — sem posição em prateleira.";
            el.classList.remove("vazio");
            return;
        }
        const n = parseInt(document.getElementById("nivel").value, 10);
        const e = parseInt(document.getElementById("espaco").value, 10);
        if(!isNaN(n) && !isNaN(e) && n >= 1 && n <= 13 && e >= 1 && e <= 6){
            el.textContent = "Posição selecionada: nível " + n + ", espaço " + e;
            el.classList.remove("vazio");
        } else {
            el.innerHTML = "Escolha um espaço <strong>cinza</strong> no mapa desta prateleira.";
            el.classList.add("vazio");
        }
    }

    function atualizarOpcoesResponsavel(){
        const dataList = document.getElementById("listaResponsaveis");
        if(!dataList) return;
        const st = document.getElementById("status") ? document.getElementById("status").value : "";
        
        let lista = [];
        if(!db.responsaveis) db.responsaveis = [];
        
        if(st){
            let funcaoAlvo = "";
            if (st === "Preparada") funcaoAlvo = "Preparador";
            else if (st === "Digitalizada") funcaoAlvo = "Digitalizador";
            
            if (funcaoAlvo) {
                lista = db.responsaveis.filter(r => r.funcao === funcaoAlvo).map(r => r.nome);
            }
            if(lista.length === 0){
                lista = db.responsaveis.map(r => r.nome);
            }
        } else {
            lista = db.responsaveis.map(r => r.nome);
        }
        
        // Remove duplicatas e ordena
        lista = Array.from(new Set(lista)).sort();
        
        dataList.innerHTML = '';
        lista.forEach(nome => {
            const opt = document.createElement("option");
            opt.value = nome;
            dataList.appendChild(opt);
        });
    }

    function atualizarOpcoesResponsavelLista(){
        const dataList = document.getElementById("listaResponsaveisFiltro");
        if(!dataList) return;
        const st = document.getElementById("filtroStatusLista") ? document.getElementById("filtroStatusLista").value : "";
        
        let lista = [];
        if(!db.responsaveis) db.responsaveis = [];
        
        if(st){
            let funcaoAlvo = "";
            if (st === "Preparada") funcaoAlvo = "Preparador";
            else if (st === "Digitalizada") funcaoAlvo = "Digitalizador";
            
            if (funcaoAlvo) {
                lista = db.responsaveis.filter(r => r.funcao === funcaoAlvo).map(r => r.nome);
            }
            if(lista.length === 0){
                lista = db.responsaveis.map(r => r.nome);
            }
        } else {
            lista = db.responsaveis.map(r => r.nome);
        }
        
        lista = Array.from(new Set(lista)).sort();
        
        dataList.innerHTML = '';
        lista.forEach(nome => {
            const opt = document.createElement("option");
            opt.value = nome;
            dataList.appendChild(opt);
        });
    }

    function onChangeFiltroStatusLista() {
        atualizarOpcoesResponsavelLista();
        buscarCaixa();
    }

    function onStatusLancamentoChange(){
        esconderMsgLancamentoOk();
        atualizarOpcoesResponsavel();
        const st = document.getElementById("status").value;
        const selPrat = document.getElementById("prateleiraSelect");
        const ph = document.getElementById("mapaLancamentoPlaceholder");
        const mapEl = document.getElementById("mapaLancamento");
        const alerta = document.getElementById("alertaStatusLanc");
        if(st === "Eliminada"){
            if(selPrat){ selPrat.disabled = true; selPrat.value = ""; }
            document.getElementById("nivel").value = "";
            document.getElementById("espaco").value = "";
            if(alerta){
                alerta.style.display = "block";
                alerta.textContent = "Eliminada: não é permitido alocar em prateleira. O endereço será removido ao salvar.";
            }
            if(ph){
                ph.style.display = "block";
                ph.textContent = "Caixa eliminada não ocupa prateleira.";
            }
            if(mapEl){ mapEl.innerHTML = ""; mapEl.style.display = "none"; }
            atualizarResumoPosicao();
            return;
        }
        if(selPrat) selPrat.disabled = false;
        if(alerta) alerta.style.display = "none";
        if(ph){
            if(!selPrat || !selPrat.value){
                ph.style.display = "block";
                ph.textContent = "Selecione uma prateleira para o mapa ou deixe em branco para caixa avulsa.";
            }
        }
        atualizarResumoPosicao();
        if(selPrat && selPrat.value){ if(ph) ph.style.display = "none"; renderMapaLancamento(); }
        else { if(mapEl){ mapEl.innerHTML = ""; mapEl.style.display = "none"; } }
    }

    function esconderMsgLancamentoOk(){
        const ok = document.getElementById("msgLancamentoOk");
        if(ok) ok.style.display = "none";
    }

    function onPrateleiraLancamentoChange(){
        esconderMsgLancamentoOk();
        const stEl = document.getElementById("status");
        if(stEl.value === "Eliminada") return;

        if(document.getElementById("prateleiraSelect").value && stEl.value === "Avulsa") stEl.value = "Guardada";

        document.getElementById("nivel").value = "";
        document.getElementById("espaco").value = "";
        atualizarResumoPosicao();
        const ph = document.getElementById("mapaLancamentoPlaceholder");
        const nome = document.getElementById("prateleiraSelect").value;
        if(ph){
            if(nome) ph.style.display = "none";
            else{
                ph.style.display = "block";
                ph.textContent = "Selecione uma prateleira para o mapa ou deixe em branco para caixa avulsa.";
            }
        }
        renderMapaLancamento();
    }

    function renderMapaLancamento(){
        const container = document.getElementById("mapaLancamento");
        if(!container) return;
        const st = document.getElementById("status") && document.getElementById("status").value;
        const ph = document.getElementById("mapaLancamentoPlaceholder");
        if(st === "Eliminada"){
            container.innerHTML = ""; container.style.display = "none"; return;
        }
        const nome = document.getElementById("prateleiraSelect").value;
        if(!nome){
            container.innerHTML = ""; container.style.display = "none"; return;
        }
        if(ph) ph.style.display = "none";
        container.style.display = "block";
        container.innerHTML = "";

        const selN = parseInt(document.getElementById("nivel").value, 10);
        const selE = parseInt(document.getElementById("espaco").value, 10);

        // OTIMIZAÇÃO PARA O MAPA DE LANÇAMENTO
        const lookup = new Map();
        db.caixas.forEach((c, i) => {
            if(caixaOcupaSlot(c) && c.prateleira === nome) {
                lookup.set(`${c.nivel}-${c.espaco}`, i);
            }
        });

        const box = document.createElement("div");
        box.className = "prateleiraBox";
        const h = document.createElement("h3");
        h.textContent = "Prateleira " + nome;
        box.appendChild(h);
        const leg = document.createElement("p");
        leg.className = "mapaLegendaLanc";
        leg.innerHTML = "<small>Verde = livre · Demais cores = ocupado (conforme status) · Moldura escura = posição escolhida para este formulário</small>";
        box.appendChild(leg);

        for(let n = 1; n <= 13; n++){
            const linha = document.createElement("div");
            linha.className = "nivel";
            const lab = document.createElement("div");
            lab.className = "nivelLabel";
            lab.textContent = "N" + n;
            linha.appendChild(lab);
                for(let e = 1; e <= 6; e++){
                // Busca otimizada instantânea
                const chave = `${n}-${e}`;
                const idx = lookup.has(chave) ? lookup.get(chave) : -1;
                
                const slot = document.createElement("div");
                const ocupadoPorOutro = idx !== -1 && idx !== edit;
                const meuSlot = idx !== -1 && idx === edit;

                if(ocupadoPorOutro){
                    const ocx = db.caixas[idx];
                    slot.classList.add("ocupado" + ocx.status, "slotOcupadoOutro");
                    slot.textContent = ocx.caixa;
                    slot.title = "Ocupado — caixa " + ocx.caixa + (ocx.unidade ? " · " + ocx.unidade : "");
                    const cx = db.caixas[idx].caixa;
                    slot.onclick = () => alert("Este espaço já está ocupado pela caixa " + cx + ". Escolha outro.");
                } else if(meuSlot){
                    slot.classList.add("ocupado" + db.caixas[idx].status, "slotEdicaoAtual");
                    if(selN === n && selE === e) slot.classList.add("slotSelecionado");
                    slot.textContent = db.caixas[idx].caixa;
                    slot.title = "Posição atual desta caixa";
                    slot.onclick = () => {
                        document.getElementById("nivel").value = n; document.getElementById("espaco").value = e;
                        atualizarResumoPosicao(); renderMapaLancamento();
                    };
                } else {
                    slot.classList.add("livre");
                    if(selN === n && selE === e) slot.classList.add("slotSelecionado");
                    slot.textContent = String(e);
                    slot.title = "Livre — clique para selecionar";
                    slot.onclick = () => {
                        document.getElementById("nivel").value = n; document.getElementById("espaco").value = e;
                        atualizarResumoPosicao(); renderMapaLancamento();
                    };
                }
                linha.appendChild(slot);
            }
            box.appendChild(linha);
        }
        container.appendChild(box);
    }

    function limparAposSalvarSucesso(){
        if(window.ERP_PAGE_ID === "index"){
            fecharModal();
            listar();
            return;
        }

        const prat = document.getElementById("prateleiraSelect").value;
        const unid = document.getElementById("unidadeSelect").value;
        edit = null;
        document.getElementById("btnSalvar").innerText = "Salvar";
        document.getElementById("btnCancelar").style.display = "none";
        document.getElementById("caixa").value = "";
        document.getElementById("unidadeSelect").value = unid;
        document.getElementById("inicio").value = "";
        document.getElementById("fim").value = "";
        document.getElementById("validade").value = "";
        document.getElementById("usuarioStatus").value = "";
        document.getElementById("status").selectedIndex = 0;
        document.getElementById("status").value = "Avulsa";
        document.querySelectorAll('input[name="procCheck"]').forEach(cb => { cb.checked = false; });
        document.getElementById("nivel").value = "";
        document.getElementById("espaco").value = "";
        document.getElementById("prateleiraSelect").disabled = false;
        document.getElementById("prateleiraSelect").value = prat;
        const alerta = document.getElementById("alertaStatusLanc");
        if(alerta) alerta.style.display = "none";
        atualizarResumoPosicao();
        const ph = document.getElementById("mapaLancamentoPlaceholder");
        if(ph && !prat) ph.textContent = "Selecione uma prateleira para o mapa ou deixe em branco para caixa avulsa.";
        if(ph) ph.style.display = prat ? "none" : "block";
        renderMapaLancamento();
        atualizarOpcoesResponsavel();
        const ok = document.getElementById("msgLancamentoOk");
        if(ok){
            ok.style.display = "inline";
            clearTimeout(window._msgLancOkT);
            window._msgLancOkT = setTimeout(() => { ok.style.display = "none"; }, 4500);
        }
    }

    async function salvar(e){
        e.preventDefault();

        let stSalvar = document.getElementById("status").value;
        let prat = (document.getElementById("prateleiraSelect").value || "").trim();
        let nl = parseInt(document.getElementById("nivel").value, 10);
        let es = parseInt(document.getElementById("espaco").value, 10);

        if(!prat && stSalvar !== "Eliminada") {
            stSalvar = "Avulsa";
        } else if(prat && stSalvar === "Avulsa") {
            stSalvar = "Guardada";
        }

        if(stSalvar === "Eliminada"){
            prat = "";
            nl = 0;
            es = 0;
        } else if(!prat){
            nl = 0;
            es = 0;
        } else {
            if(isNaN(nl) || isNaN(es) || nl < 1 || nl > 13 || es < 1 || es > 6)
                return alert("Com prateleira selecionada, escolha um espaço livre no mapa.");
        }

        const procs = Array.from(document.querySelectorAll('input[name="procCheck"]:checked')).map(cb => cb.value);

        let historicoCarry = [];
        if(edit !== null && editBoxFull){
            const h0 = editBoxFull.historico;
            historicoCarry = Array.isArray(h0) ? JSON.parse(JSON.stringify(h0)) : [];
        }

        const item = {
            caixa: document.getElementById("caixa").value,
            unidade: document.getElementById("unidadeSelect").value.trim(),
            inicio: document.getElementById("inicio").value,
            fim: document.getElementById("fim").value,
            validade: document.getElementById("validade").value,
            prateleira: prat,
            nivel: nl,
            espaco: es,
            status: stSalvar,
            usuario: document.getElementById("usuarioStatus").value,
            processos: procs,
            dataUpdate: new Date().toLocaleString(),
            historico: historicoCarry
        };

        if(caixaOcupaSlot(item)){
            const ocupado = db.caixas.find((c, idx) =>
                idx !== edit && caixaOcupaSlot(c) &&
                c.prateleira === item.prateleira && c.nivel === item.nivel && c.espaco === item.espaco
            );
            if(ocupado) return alert("Esta posição já está ocupada pela caixa " + ocupado.caixa + ". Escolha outro espaço no mapa.");
        }

        if(edit !== null && editBoxFull){
            const antes = snapshotCaixaParaHistorico(editBoxFull);
            const mud = extrairMudancasRegistro(antes, item);
            if(mud.length > 0)
                item.historico.push(criarEntradaHistorico("edicao", mud, item.usuario));
        } else {
            item.historico = [criarEntradaHistorico("criacao", mudancasIniciaisCadastro(item), item.usuario)];
        }

        if(edit !== null && editBoxFull && editBoxFull.documentos){
            item.documentos = parseInt(editBoxFull.documentos, 10) || 0;
        }

        const shortMem = criarShortItem(item);
        if(edit !== null) db.caixas[edit] = shortMem;
        else db.caixas.push(shortMem);

        await salvarDB({ caixas: [item], msgCarregamento: "Salvando caixa…" });
        limparAposSalvarSucesso();
        atualizarInterface();
    }

    // --- NOVA FUNÇÃO LISTAR (COM 5 FILTROS CRUZADOS E PAGINAÇÃO) ---
    function listar(){
        const lista = document.getElementById("lista");
        if(!lista) return;
        
        // Pega os valores dos 5 campos de filtro
        const buscaEl = document.getElementById("buscarCaixa");
        const buscaTexto = (buscaEl ? buscaEl.value : "").toLowerCase().trim();
        
        const filtroUnidadeEl = document.getElementById("filtroUnidadeLista");
        const unidadeSelecionada = filtroUnidadeEl ? filtroUnidadeEl.value : "";

        const filtroStatusEl = document.getElementById("filtroStatusLista");
        const statusSelecionado = filtroStatusEl ? filtroStatusEl.value : "";
        
        const filtroProcessoEl = document.getElementById("filtroProcessoLista");
        const processoSelecionado = filtroProcessoEl ? filtroProcessoEl.value : "";

        const filtroRespEl = document.getElementById("filtroResponsavelLista");
        const buscaResp = (filtroRespEl ? filtroRespEl.value : "").toLowerCase().trim();

        // 1. Filtra cruzando todas as regras
        const filtrados = db.caixas.filter(c => {
            // Regra 1: Número da Caixa
            let passouTexto = true;
            if (buscaTexto) {
                const cx = (c.caixa || "").toLowerCase();
                passouTexto = cx.includes(buscaTexto);
            }

            // Regra 2: Unidade
            let passouUnidade = true;
            if (unidadeSelecionada) {
                passouUnidade = (c.unidade === unidadeSelecionada);
            }

            // Regra 3: Status
            let passouStatus = true;
            if (statusSelecionado) {
                passouStatus = c.status === statusSelecionado;
            }

            // Regra 4: Processos
            let passouProcesso = true;
            if (processoSelecionado) {
                passouProcesso = c.processos && c.processos.includes(processoSelecionado);
            }

            // Regra 5: Responsável
            let passouResp = true;
            if (buscaResp) {
                const resp = (c.usuario || "").toLowerCase();
                passouResp = resp.includes(buscaResp);
            }

            // A caixa só aparece se passar nas 5 regras ao mesmo tempo
            return passouTexto && passouUnidade && passouStatus && passouProcesso && passouResp;
        });

        // 2. Lógica de Paginação
        const totalPaginas = Math.ceil(filtrados.length / itensPorPagina) || 1;
        if(paginaAtual > totalPaginas) paginaAtual = totalPaginas;
        if(paginaAtual < 1) paginaAtual = 1;

        const inicio = (paginaAtual - 1) * itensPorPagina;
        const fim = inicio + itensPorPagina;
        const caixasPagina = filtrados.slice(inicio, fim);

        // 3. Renderiza apenas as caixas da página atual
        lista.innerHTML = "";
        
        if (filtrados.length === 0) {
            lista.innerHTML = "<tr><td colspan='6' style='padding: 30px; color: #7f8c8d;'>Nenhuma caixa encontrada com estes filtros.</td></tr>";
        }
        
        caixasPagina.forEach((c) => {
            const idxReal = db.caixas.indexOf(c);
            const unid = c.unidade ? `<span class="badge" style="background:#8e44ad">${c.unidade}</span>` : "—";
            const tagsProc = c.processos ? c.processos.map(p => `<span class="processo-tag">${p}</span>`).join('') : "";

            lista.innerHTML += `<tr onclick="detalhes(${idxReal})">
                <td><b>${c.caixa}</b></td>
                <td>${unid}</td>
                <td>${tagsProc}</td>
                <td><span class="badge" style="background:${getColor(c.status)}">${c.status}</span></td>
                <td>${formatarLocalCaixa(c)}</td>
                <td class="td-acoes">
                    <button class="btn-editar" onclick="event.stopPropagation(); editar(${idxReal})" title="Editar Caixa">✏️ Editar</button>
                    <button class="btn-excluir" onclick="event.stopPropagation(); remover(${idxReal})" title="Excluir Caixa">🗑️ Excluir</button>
                </td>
            </tr>`;
        });
        
        // 4. Desenha os botões de paginação
        renderizarPaginacao(filtrados.length, totalPaginas);
        
        if(document.getElementById("mapa")) mapa();
    }

    // --- NOVA FUNÇÃO BUSCAR (RESETA A PÁGINA) ---
    function buscarCaixa() { 
        paginaAtual = 1;
        listar(); 
    }

    function getColor(s){
        const colors = {Guardada:'#27ae60', Avulsa:'#9b59b6', Preparada:'#f1c40f', Digitalizada:'#3498db', Eliminada:'#e74c3c'};
        return colors[s] || '#7f8c8d';
    }

    function editar(i){
        if(window.ERP_PAGE_ID === "index") {
            abrirModalEdicao(i);
        } else {
            window.location.href = "lancamento.html?edit=" + encodeURIComponent(i);
        }
    }

    function abrirModalEdicao(i) {
        const c = db.caixas[i];
        if(!c) return;

        const html = `
        <div id="lancamentoTela" style="text-align: left;">
            <h2 style="margin-top:0;">📝 Editar Caixa: ${escModal(c.caixa)}</h2>
            <form id="cadastroForm" class="modal-inner" onsubmit="salvar(event)">
                <div class="modal-scroll-body">
                <div class="card" style="box-shadow:none; padding:0;">
                    <div class="lancamento-secao">
                        <h3>1 · Identificação e prazos</h3>
                        <div class="lancamento-grid">
                            <div class="campo">
                                <label for="caixa">Número da caixa</label>
                                <input id="caixa" placeholder="Ex.: 2024-001" required autocomplete="off">
                            </div>
                            <div class="campo">
                                <label for="unidadeSelect">Unidade</label>
                                <select id="unidadeSelect">
                                    <option value="">— Não informada —</option>
                                </select>
                            </div>
                            <div class="campo">
                                <label for="inicio">Data de início</label>
                                <input type="date" id="inicio" required title="Data de início do conteúdo">
                            </div>
                            <div class="campo">
                                <label for="fim">Data fim <span style="font-weight:normal;color:#888">(opcional)</span></label>
                                <input type="date" id="fim" title="Data fim">
                            </div>
                            <div class="campo">
                                <label for="validade">Validade</label>
                                <input type="date" id="validade" required title="Data de validade">
                            </div>
                        </div>
                    </div>

                    <div class="lancamento-secao">
                        <h3>2 · Prateleira (opcional) e posição</h3>
                        <div class="alerta-status-lanc" id="alertaStatusLanc" style="display:none;margin:8px 0;padding:10px;border-radius:6px;background:#fdedec;color:#922b21;font-size:13px;"></div>
                        <div class="campo" style="max-width:420px;">
                            <label for="prateleiraSelect">Prateleira</label>
                            <select id="prateleiraSelect" onchange="onPrateleiraLancamentoChange()">
                                <option value="">— Caixa avulsa (sem prateleira) —</option>
                            </select>
                        </div>
                        <p id="mapaLancamentoPlaceholder" class="mapaLegendaLanc" style="margin-top:8px;">Selecione uma prateleira para ver o mapa ou deixe em branco para caixa avulsa.</p>
                        <div id="mapaLancamento"></div>
                        <input type="hidden" id="nivel" value="">
                        <input type="hidden" id="espaco" value="">
                        <div id="posicaoLancamentoResumo" class="posicaoResumo vazio" role="status">Nenhuma posição selecionada — clique em um espaço <strong>Cinza</strong> no mapa.</div>
                    </div>

                    <div class="lancamento-secao">
                        <h3>3 · Situação e responsável</h3>
                        <div class="lancamento-grid">
                            <div class="campo">
                                <label for="status">Status</label>
                                <select id="status" onchange="onStatusLancamentoChange()">
                                    <option value="Avulsa">Avulsa</option>
                                    <option value="Guardada">Guardada</option>
                                    <option value="Preparada">Preparada</option>
                                    <option value="Digitalizada">Digitalizada</option>
                                    <option value="Eliminada">Eliminada</option>
                                </select>
                            </div>
                            <div class="campo">
                                <label for="usuarioStatus">Responsável</label>
                                <input id="usuarioStatus" list="listaResponsaveis" placeholder="Nome do responsável" autocomplete="name">
                                <datalist id="listaResponsaveis"></datalist>
                            </div>
                        </div>
                    </div>

                    <div class="lancamento-secao">
                        <h3>4 · Processos vinculados</h3>
                        <div id="processosContainer"></div>
                    </div>
                </div>
                </div>
                <div class="modal-footer-actions">
                    <button type="button" class="btn-sec" id="btnCancelar" onclick="fecharModal()">Cancelar</button>
                    <button type="submit" class="btn-prim" id="btnSalvar">Salvar Alterações</button>
                </div>
            </form>
        </div>
        `;

        abrirModal("", { wide: true, htmlCompleto: html });

        renderSelectPrateleiras();
        renderSelectUnidades();
        renderCheckboxesProcessos();
        atualizarOpcoesResponsavel();

        preencherFormularioEdicao(i);
    }

    async function preencherFormularioEdicao(i){
        if(typeof esconderMsgLancamentoOk === "function") esconderMsgLancamentoOk();
        const cShort = db.caixas[i];
        if(!cShort) return;
        
        editBoxFull = await carregarDetalhesCaixa(cShort.caixa, cShort.prateleira, cShort.status);
        const c = editBoxFull || cShort;
        
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
        
        setVal("caixa", c.caixa);
        setVal("unidadeSelect", c.unidade || "");
        setVal("inicio", c.inicio || "");
        setVal("fim", c.fim || "");
        setVal("validade", c.validade || "");
        setVal("prateleiraSelect", c.prateleira || "");
        setVal("nivel", (c.nivel && parseInt(c.nivel, 10) >= 1) ? c.nivel : "");
        setVal("espaco", (c.espaco && parseInt(c.espaco, 10) >= 1) ? c.espaco : "");
        setVal("status", c.status);
        setVal("usuarioStatus", c.usuario || "");

        document.querySelectorAll('input[name="procCheck"]').forEach(cb => {
            cb.checked = c.processos && c.processos.includes(cb.value);
        });

        edit = i;
        const btnSalvar = document.getElementById("btnSalvar");
        if(btnSalvar) btnSalvar.innerText = "Atualizar";
        const btnCancelar = document.getElementById("btnCancelar");
        if(btnCancelar) btnCancelar.style.display = "inline-block";
        if(typeof onStatusLancamentoChange === "function") onStatusLancamentoChange();
        if(window.ERP_PAGE_ID === "lancamento") window.scrollTo(0, 0);
    }

    function cancelarEdicao(){
        esconderMsgLancamentoOk();
        edit = null;
        editBoxFull = null;
        document.getElementById("prateleiraSelect").disabled = false;
        const alerta = document.getElementById("alertaStatusLanc");
        if(alerta) alerta.style.display = "none";
        document.getElementById("cadastroForm").reset();
        document.querySelectorAll('input[name="procCheck"]').forEach(cb => cb.checked = false);
        document.getElementById("btnSalvar").innerText = "Salvar";
        document.getElementById("btnCancelar").style.display = "none";
        atualizarResumoPosicao();
        const ph = document.getElementById("mapaLancamentoPlaceholder");
        if(ph){
            ph.style.display = "block";
            ph.textContent = "Selecione uma prateleira para o mapa ou deixe em branco para caixa avulsa.";
        }
        renderMapaLancamento();
    }

    async function remover(i){
        if(confirm("Excluir esta caixa?")){
            const cShort = db.caixas[i];
            db.caixas.splice(i, 1);
            await salvarDB({ removerCaixas: [cShort] });
            atualizarInterface();
        }
    }

    // ---------------- MAPA E AUXS ----------------
    function mapa(){
        const container = document.getElementById("mapa");
        if(!container) return;

        // --- 1. Lógica de Busca ---
        const buscaEl = document.getElementById("buscarPrateleiraMapa");
        const busca = (buscaEl ? buscaEl.value : "").toLowerCase().trim();

        let prateleirasFiltradas = db.prateleiras;
        if (busca) {
            prateleirasFiltradas = db.prateleiras.filter(p => p.nome.toLowerCase().includes(busca));
        }

        // --- 2. Lógica de Paginação das Prateleiras ---
        const totalPrateleiras = prateleirasFiltradas.length;
        const totalPaginas = Math.ceil(totalPrateleiras / prateleirasPorPagina) || 1;
        
        if(paginaAtualMapa > totalPaginas) paginaAtualMapa = totalPaginas;
        if(paginaAtualMapa < 1) paginaAtualMapa = 1;

        const inicio = (paginaAtualMapa - 1) * prateleirasPorPagina;
        const fim = inicio + prateleirasPorPagina;
        const prateleirasPagina = prateleirasFiltradas.slice(inicio, fim); 

        // --- 3. OTIMIZAÇÃO EXTREMA (Dicionário) ---
        const lookup = new Map();
        const nomesPrats = new Set(prateleirasPagina.map(p => p.nome));
        
        db.caixas.forEach((c, idx) => {
            if(caixaOcupaSlot(c) && nomesPrats.has(c.prateleira)){
                lookup.set(`${c.prateleira}-${c.nivel}-${c.espaco}`, idx);
            }
        });

        container.innerHTML = "";
        
        // Mensagem se a busca não encontrar nada
        if (totalPrateleiras === 0) {
            container.innerHTML = "<div style='text-align:center; padding: 40px; color: #7f8c8d; font-size: 16px; width: 100%;'>Nenhuma prateleira encontrada com este nome.</div>";
            renderizarPaginacaoMapa(0, 1);
            return;
        }
        
        // --- 4. Desenha as prateleiras ---
        prateleirasPagina.forEach(p => {
            const box = document.createElement("div");
            box.className = "prateleiraBox";
            box.innerHTML = `<h3>Prateleira ${p.nome}</h3>`;
            for(let n = 1; n <= 13; n++){
                const linha = document.createElement("div"); linha.className = "nivel";
                linha.innerHTML = `<div class="nivelLabel">N${n}</div>`;
                for(let e=1; e<=6; e++){
                    const chave = `${p.nome}-${n}-${e}`;
                    const idx = lookup.has(chave) ? lookup.get(chave) : -1;
                    
                    const slot = document.createElement("div");
                    if(idx !== -1){
                        const cx = db.caixas[idx];
                        slot.className = "slot ocupado" + cx.status;
                        slot.innerText = cx.caixa;
                        slot.title = (cx.unidade ? cx.unidade + " · " : "") + cx.status + " · clique para detalhes";
                        slot.onclick = () => detalhes(idx);
                    } else {
                        slot.className = "slot livre"; slot.innerText = e;
                    }
                    linha.appendChild(slot);
                }
                box.appendChild(linha);
            }
            container.appendChild(box);
        });

        // --- 5. Renderiza os botões de paginação do Mapa ---
        renderizarPaginacaoMapa(totalPrateleiras, totalPaginas);
    }

    function fecharMenuDropdown(){
        const menu = document.getElementById("menu");
        const ham = document.getElementById("hamburger");
        if(menu) menu.classList.remove("show");
        if(ham) ham.classList.remove("active");
    }

    function toggleMenu(){
        const menu = document.getElementById("menu");
        const ham = document.getElementById("hamburger");
        if(menu) menu.classList.toggle("show");
        if(ham) ham.classList.toggle("active");
    }

    async function detalhes(i){
        const cShort = db.caixas[i];
        if(!cShort) return;
        mostrarCarregamento("Carregando detalhes…");
        let c;
        try {
            c = await carregarDetalhesCaixa(cShort.caixa, cShort.prateleira, cShort.status) || cShort;
        } finally {
            esconderCarregamento();
        }
        const procs = c.processos ? c.processos.join(", ") : "Nenhum";
        const docs = parseInt(c.documentos, 10) || 0;
        abrirModal(`
            <h3>Caixa: ${escModal(c.caixa)}</h3>
            <p><b>Unidade:</b> ${escModal(c.unidade || "—")}</p>
            <p><b>Processos:</b> ${escModal(procs)}</p>
            <p><b>Local:</b> ${escModal(formatarLocalCaixa(c))}</p>
            <p><b>Status:</b> ${escModal(c.status)}</p>
            <p><b>Validade:</b> ${escModal(c.validade)}</p>
            <p><b>Documentos:</b> ${docs.toLocaleString('pt-BR')}</p>
            <p><b>Responsável:</b> ${escModal(c.usuario)}</p>
            <p><small>Última atualização: ${escModal(c.dataUpdate || "N/A")}</small></p>
            <h4 style="margin:16px 0 6px 0;font-size:14px;color:#2c3e50;">Histórico</h4>
            <div class="historico-caixa">${renderHtmlHistorico(c)}</div>
        `, { wide: true, footer: '<button type="button" class="btn-prim" onclick="fecharModal()">Fechar</button>' });
    }
    function fecharModal(){
        document.getElementById("modal").style.display = "none";
        const conteudo = document.getElementById("modalConteudo");
        if(conteudo) {
            conteudo.innerHTML = "";
            conteudo.style.padding = "";
        }
        const mb = document.querySelector("#modal .modalBox");
        if(mb) {
            mb.classList.remove("modal-wide");
            mb.style.padding = "";
        }
        if(window.ERP_PAGE_ID === "index") edit = null;
    }

    function hojeISO(){
        const d = new Date();
        const z = n => String(n).padStart(2,"0");
        return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
    }

    function addDiasISO(dias){
        const d = new Date();
        d.setDate(d.getDate() + dias);
        const z = n => String(n).padStart(2,"0");
        return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
    }

    function preencherSelectsDashboard(){
        const selPrat = document.getElementById("dashPrateleira");
        if(!selPrat) return;
        const valPrat = selPrat.value;
        selPrat.innerHTML = '<option value="">Todas as prateleiras</option>';
        const oA = document.createElement("option");
        oA.value = "__avulsa__";
        oA.textContent = "Somente caixas avulsas (sem prateleira)";
        selPrat.appendChild(oA);
        db.prateleiras.forEach(p => {
            const o = document.createElement("option");
            o.value = p.nome;
            o.textContent = p.nome;
            selPrat.appendChild(o);
        });
        if([...selPrat.options].some(o => o.value === valPrat)) selPrat.value = valPrat;

        const selUn = document.getElementById("dashUnidade");
        if(selUn){
            const valUn = selUn.value;
            selUn.innerHTML = '<option value="">Todas as unidades</option>';
            
            // Map e Format das Unidades no Dashboard
            let opcoesFormatadas = (db.unidades || []).map(u => {
                if(typeof u === 'string') return u;
                return `${u.numero} - ${u.nome}`;
            });
            opcoesFormatadas.sort((a, b) => a.localeCompare(b, "pt")).forEach(u => {
                const o = document.createElement("option");
                o.value = u;
                o.textContent = u;
                selUn.appendChild(o);
            });
            if([...selUn.options].some(o => o.value === valUn)) selUn.value = valUn;
        }

        const selProc = document.getElementById("dashProcesso");
        if(!selProc) return;
        const prev = dashProcessoInicializado ? [...selProc.querySelectorAll('input[type="checkbox"]:checked')].map(o => o.value) : null;
        selProc.innerHTML = "";
        db.processos.forEach(n => {
            const lbl = document.createElement("label");
            lbl.className = "status-badge";
            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.value = n;
            lbl.appendChild(chk);
            lbl.appendChild(document.createTextNode(" " + n));
            selProc.appendChild(lbl);
        });
        if(!dashProcessoInicializado){
            [...selProc.querySelectorAll('input[type="checkbox"]')].forEach(o => { o.checked = true; });
            dashProcessoInicializado = true;
        } else {
            [...selProc.querySelectorAll('input[type="checkbox"]')].forEach(o => { o.checked = prev.includes(o.value); });
            if([...selProc.querySelectorAll('input[type="checkbox"]')].every(o => !o.checked))
                [...selProc.querySelectorAll('input[type="checkbox"]')].forEach(o => { o.checked = true; });
        }
    }

    function caixasFiltradasDashboard(){
        const q = (document.getElementById("dashBusca").value || "").trim().toLowerCase();
        const rapido = document.getElementById("dashFiltroRapido").value;
        const vd = document.getElementById("dashValidadeDe").value;
        const va = document.getElementById("dashValidadeAte").value;
        const id = document.getElementById("dashInicioDe").value;
        const ia = document.getElementById("dashInicioAte").value;
        const prat = document.getElementById("dashPrateleira").value;
        const procOpts = document.getElementById("dashProcesso");
        const procSel = procOpts ? [...procOpts.querySelectorAll('input[type="checkbox"]:checked')].map(o => o.value) : [];
        const todosProcs = db.processos.length === 0 || procSel.length === 0 || procSel.length === db.processos.length;
        const statusChecks = [...document.querySelectorAll('input[name="dashSt"]:checked')].map(i => i.value);
        const todosStatus = statusChecks.length === 5;
        const hoje = hojeISO();
        const lim30 = addDiasISO(30);
        const lim90 = addDiasISO(90);

        return db.caixas.filter(c => {
            if(q){
                const u = (c.usuario || "").toLowerCase();
                const cx = (c.caixa || "").toLowerCase();
                const ux = (c.unidade || "").toLowerCase();
                if(!cx.includes(q) && !u.includes(q) && !ux.includes(q)) return false;
            }
            if(rapido === "vencidas"){
                if(!c.validade || c.validade >= hoje) return false;
            } else if(rapido === "vence30"){
                if(!c.validade || c.validade < hoje || c.validade > lim30) return false;
            } else if(rapido === "vence90"){
                if(!c.validade || c.validade < hoje || c.validade > lim90) return false;
            }
            if(vd && (!c.validade || c.validade < vd)) return false;
            if(va && (!c.validade || c.validade > va)) return false;
            
            let altDate = null;
            if(c.dataUpdate) {
                const matchBr = String(c.dataUpdate).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
                if(matchBr) {
                    altDate = `${matchBr[3]}-${matchBr[2].padStart(2, '0')}-${matchBr[1].padStart(2, '0')}`;
                } else if(String(c.dataUpdate).match(/^\d{4}-\d{2}-\d{2}/)) {
                    altDate = String(c.dataUpdate).substring(0, 10);
                }
            }
            if(id && (!altDate || altDate < id)) return false;
            if(ia && (!altDate || altDate > ia)) return false;

            if(prat === "__avulsa__"){
                if(c.prateleira && String(c.prateleira).trim()) return false;
            } else if(prat && c.prateleira !== prat) return false;
            const unF = document.getElementById("dashUnidade") && document.getElementById("dashUnidade").value;
            if(unF && (c.unidade || "") !== unF) return false;
            if(!todosStatus && !statusChecks.includes(c.status)) return false;
            if(!todosProcs){
                const bp = c.processos || [];
                if(!procSel.some(p => bp.includes(p))) return false;
            }
            return true;
        });
    }

    function aplicarFiltrosDashboard(){ renderDashboardDados(); }

    function limparFiltrosDashboard(){
        document.getElementById("dashBusca").value = "";
        document.getElementById("dashFiltroRapido").value = "";
        document.getElementById("dashValidadeDe").value = "";
        document.getElementById("dashValidadeAte").value = "";
        document.getElementById("dashInicioDe").value = "";
        document.getElementById("dashInicioAte").value = "";
        document.getElementById("dashPrateleira").value = "";
        const du = document.getElementById("dashUnidade");
        if(du) du.value = "";
        document.querySelectorAll('input[name="dashSt"]').forEach(i => { i.checked = true; });
        const sp = document.getElementById("dashProcesso");
        if(sp) [...sp.querySelectorAll('input[type="checkbox"]')].forEach(o => { o.checked = true; });
        renderDashboardDados();
    }

    function agregarParaGrafico(dim, caixas, metrica = 'caixas'){
        const map = new Map();
        const coresStatus = { Guardada:"#27ae60", Preparada:"#f1c40f", Digitalizada:"#3498db", Eliminada:"#e74c3c", Avulsa:"#9b59b6" };

        function getValorIncremento(caixa) {
            if (metrica === 'documentos') {
                return (parseInt(caixa.documentos, 10) || 0);
            }
            return 1;
        }

        if(dim === "status"){
            ["Guardada","Avulsa","Preparada","Digitalizada","Eliminada"].forEach(s => map.set(s, 0));
            caixas.forEach(c => {
                const k = c.status || "—";
                map.set(k, (map.get(k) || 0) + getValorIncremento(c));
            });
        } else if(dim === "prateleira"){
            db.prateleiras.forEach(p => map.set(p.nome, 0));
            map.set("(Avulsa)", 0);
            caixas.forEach(c => {
                const k = (c.prateleira && String(c.prateleira).trim()) ? c.prateleira : "(Avulsa)";
                map.set(k, (map.get(k) || 0) + getValorIncremento(c));
            });
        } else if(dim === "nivel"){
            for(let n = 1; n <= 13; n++) map.set("Nível " + n, 0);
            caixas.forEach(c => {
                const n = c.nivel;
                if(n >= 1 && n <= 13) map.set("Nível " + n, (map.get("Nível " + n) || 0) + getValorIncremento(c));
            });
        } else if(dim === "usuario"){
            caixas.forEach(c => {
                const k = (c.usuario && String(c.usuario).trim()) ? String(c.usuario).trim() : "(não informado)";
                map.set(k, (map.get(k) || 0) + getValorIncremento(c));
            });
        } else if(dim === "mes_validade"){
            caixas.forEach(c => {
                if(!c.validade || c.validade.length < 7) return;
                const k = c.validade.slice(0, 7);
                map.set(k, (map.get(k) || 0) + getValorIncremento(c));
            });
        } else if(dim === "mes_alteracao"){
            caixas.forEach(c => {
                let altDate = null;
                if(c.dataUpdate) {
                    const matchBr = String(c.dataUpdate).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
                    if(matchBr) {
                        altDate = `${matchBr[3]}-${matchBr[2].padStart(2, '0')}`;
                    } else if(String(c.dataUpdate).match(/^\d{4}-\d{2}-\d{2}/)) {
                        altDate = String(c.dataUpdate).substring(0, 7);
                    }
                }
                if(!altDate) return;
                map.set(altDate, (map.get(altDate) || 0) + getValorIncremento(c));
            });
        } else if(dim === "processo"){
            caixas.forEach(c => {
                const ps = (c.processos && c.processos.length) ? c.processos : ["(sem processo)"];
                ps.forEach(p => map.set(p, (map.get(p) || 0) + getValorIncremento(c)));
            });
        } else if(dim === "unidade"){
            caixas.forEach(c => {
                const k = (c.unidade && String(c.unidade).trim()) ? String(c.unidade).trim() : "(sem unidade)";
                map.set(k, (map.get(k) || 0) + getValorIncremento(c));
            });
        }

        let entries = [...map.entries()].filter(([, v]) => v > 0);
        if((dim === "processo" || dim === "unidade") && entries.length > 12){
            entries.sort((a, b) => b[1] - a[1]);
            const top = entries.slice(0, 11);
            const rest = entries.slice(11).reduce((s, x) => s + x[1], 0);
            entries = [...top, ["Outros", rest]];
        }
        if((dim === "mes_validade" || dim === "mes_alteracao") && entries.length){
            entries.sort((a, b) => a[0].localeCompare(b[0]));
        }
        const labels = entries.map(x => x[0]);
        const values = entries.map(x => x[1]);
        return { labels, values, coresStatus, dim };
    }

    function paletaCores(n, dim, labels, coresStatus){
        const base = ["#3498db","#9b59b6","#1abc9c","#e67e22","#34495e","#16a085","#d35400","#8e44ad","#27ae60","#c0392b","#2980b9","#f39c12","#7f8c8d","#2ecc71","#e74c3c"];
        return labels.map((lb, i) => {
            if(dim === "status" && coresStatus[lb]) return coresStatus[lb];
            return base[i % base.length];
        });
    }

    function destruirDashboardCharts(){
        [_dashChart1, _dashChart2].forEach(ch => {
            if(ch){ ch.destroy(); }
        });
        _dashChart1 = _dashChart2 = null;
    }

    function montarChart(canvasId, dimSelectId, tipoSelectId, caixas){
        const canvas = document.getElementById(canvasId);
        if(!canvas) return;
        const wrap = canvas.closest(".chart-wrap");
        const dim = document.getElementById(dimSelectId).value;
        const tipo = document.getElementById(tipoSelectId).value;
        
        let metrica = 'caixas';
        const metricaSelectId = dimSelectId.replace('Dim', 'Metrica');
        if(document.getElementById(metricaSelectId)) {
            metrica = document.getElementById(metricaSelectId).value;
        }

        const { labels, values, coresStatus } = agregarParaGrafico(dim, caixas, metrica);
        const semDados = !values.length || values.every(v => v === 0);

        let alvoMsg = wrap.querySelector(".dash-chart-msg");
        if(!alvoMsg){
            alvoMsg = document.createElement("div");
            alvoMsg.className = "dash-empty dash-chart-msg";
            wrap.appendChild(alvoMsg);
        }
        if(semDados){
            canvas.style.display = "none";
            alvoMsg.style.display = "block";
            alvoMsg.textContent = "Nenhum dado para os filtros atuais nesta dimensão.";
            return;
        }
        canvas.style.display = "block";
        alvoMsg.style.display = "none";

        const cores = paletaCores(labels.length, dim, labels, coresStatus);
        const ctx = canvas.getContext("2d");
        const isCartesian = tipo === "bar" || tipo === "line";
        const cfg = {
            type: tipo,
            data: {
                labels,
                datasets: [{
                    label: "Quantidade",
                    data: values,
                    backgroundColor: isCartesian ? cores.map(c => tipo === "line" ? "rgba(52,152,219,0.25)" : c) : cores,
                    borderColor: tipo === "line" ? "#2980b9" : isCartesian ? cores : "#fff",
                    borderWidth: isCartesian ? 1 : 2,
                    fill: tipo === "line"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    // Esconde a legenda se houver mais de 12 fatias para não quebrar a tela
                    legend: { 
                        display: (tipo === "pie" || tipo === "doughnut" || tipo === "polarArea") && labels.length <= 12,
                        position: 'right', // Coloca a legenda na direita para ficar mais elegante
                        labels: { boxWidth: 12, font: { size: 11 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(44, 62, 80, 0.9)',
                        titleFont: { size: 14 },
                        bodyFont: { size: 13 },
                        padding: 10,
                        cornerRadius: 8
                    }
                },
                scales: isCartesian ? {
                    y: { beginAtZero: true, grid: { color: '#ecf0f1' } },
                    x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } }
                } : {}
            }
        };
        if(tipo === "line"){
            cfg.data.datasets[0].backgroundColor = "rgba(52,152,219,0.2)";
            cfg.data.datasets[0].borderColor = "#2980b9";
            cfg.data.datasets[0].borderWidth = 2;
            cfg.data.datasets[0].tension = 0.25;
        }

        const inst = new Chart(ctx, cfg);
        if(canvasId === "chartDashboard1") _dashChart1 = inst;
        else _dashChart2 = inst;
    }

    function animarNumeros(elementId, endValue, duration) {
        const obj = document.getElementById(elementId);
        if(!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // Efeito EaseOut sutil
            const easeProgress = progress * (2 - progress); 
            obj.innerHTML = Math.floor(easeProgress * endValue).toLocaleString('pt-BR');
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                obj.innerHTML = endValue.toLocaleString('pt-BR'); // Garante o valor final exato
            }
        };
        window.requestAnimationFrame(step);
    }

    function renderKpis(filtradas){
        const el = document.getElementById("dashboardKpis");
        if(!el) return;
        const hoje = hojeISO();
        const lim30 = addDiasISO(30);
        const vencidas = filtradas.filter(c => c.validade && c.validade < hoje).length;
        const vence30 = filtradas.filter(c => c.validade && c.validade >= hoje && c.validade <= lim30).length;

        const ocupamSlot = filtradas.filter(caixaOcupaSlot).length;
        const comPratNome = filtradas.filter(c => c.prateleira && String(c.prateleira).trim());
        const pratsUsadas = new Set(comPratNome.map(c => c.prateleira));
        let cap = 0;
        db.prateleiras.forEach(p => {
            if(pratsUsadas.has(p.nome)) cap += (p.capacidade || 78);
        });
        if(cap === 0 && ocupamSlot > 0) cap = pratsUsadas.size * 78;
        const pctOcup = cap ? Math.min(100, Math.round((ocupamSlot / cap) * 100)) : 0;

        const porSt = {};
        filtradas.forEach(c => { porSt[c.status] = (porSt[c.status] || 0) + 1; });
        const badges = ["Guardada","Avulsa","Preparada","Digitalizada","Eliminada"].map(s => {
            const n = porSt[s] || 0;
            const bg = getColor(s);
            if(n > 0) return `<span class="badge" style="background:${bg}">${s}: ${n.toLocaleString('pt-BR')}</span>`;
            return '';
        }).join(" ");
        
        let totalDocs = 0;
        filtradas.forEach(c => {
            totalDocs += parseInt(c.documentos, 10) || 0;
        });

        const numDigitalizadores = (db.responsaveis || []).filter(r => r.funcao === "Digitalizador" || r.funcao === "Administrador").length;
        const mediaPorDig = numDigitalizadores > 0 ? Math.round(totalDocs / numDigitalizadores) : 0;
        const caixasComDocs = filtradas.filter(c => (parseInt(c.documentos, 10) || 0) > 0);
        const mediaPorCaixa = caixasComDocs.length > 0 ? Math.round(totalDocs / caixasComDocs.length) : 0;

        el.innerHTML = `
            <div class="kpi-card">
                <div class="kpi-lbl">Caixas no Filtro</div>
                <div class="kpi-val" id="kpiTotal">0</div>
                <div class="kpi-sub">Total geral no banco: <b>${db.caixas.length.toLocaleString('pt-BR')}</b></div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl">Ocupação Estimada</div>
                <div class="kpi-val" id="kpiOcupacao">0</div>
                <div class="kpi-sub">Ref: ${pratsUsadas.size} prateleiras em uso</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl">Status de Validade</div>
                <div class="kpi-val" style="color:#e74c3c" id="kpiVencidas">0</div>
                <div class="kpi-sub">Vencidas · <span style="color:#f39c12; font-weight:bold;">${vence30}</span> a vencer em 30 dias</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl">Total de Documentos</div>
                <div class="kpi-val" id="kpiTotalDocs">0</div>
                <div class="kpi-sub">Soma registrada nas caixas filtradas</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl">Média Docs / Caixa</div>
                <div class="kpi-val" id="kpiMediaCaixa">0</div>
                <div class="kpi-sub">Média entre as ${caixasComDocs.length.toLocaleString('pt-BR')} caixa(s) com documentos</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl">Média Docs / Digitalizador</div>
                <div class="kpi-val" id="kpiMediaPorDig">0</div>
                <div class="kpi-sub">Ref: ${numDigitalizadores} digitalizador(es) cadastrado(s)</div>
            </div>
            <div class="kpi-card" style="flex:2; min-width:280px;">
                <div class="kpi-lbl">Distribuição Atual</div>
                <div class="kpi-inline">${badges || '<span style="color:#95a5a6; background:none; box-shadow:none;">Nenhum dado</span>'}</div>
            </div>
        `;

        // Dispara a animação dos números assim que os cards são desenhados na tela
        setTimeout(() => {
            animarNumeros("kpiTotal", filtradas.length, 1000);
            const objOcupacao = document.getElementById("kpiOcupacao");
            if(objOcupacao) objOcupacao.innerHTML = cap ? pctOcup + "%" : "—";
            animarNumeros("kpiVencidas", vencidas, 1000);
            animarNumeros("kpiTotalDocs", totalDocs, 1000);
            animarNumeros("kpiMediaCaixa", mediaPorCaixa, 1000);
            animarNumeros("kpiMediaPorDig", mediaPorDig, 1000);
        }, 100);    }

    function renderDashboardDados(){
        preencherSelectsDashboard();
        const filtradas = caixasFiltradasDashboard();
        renderKpis(filtradas);
        destruirDashboardCharts();
        montarChart("chartDashboard1", "dashDim1", "dashTipo1", filtradas);
        montarChart("chartDashboard2", "dashDim2", "dashTipo2", filtradas);
    }

    function renderDashboardDadosDebounced(){
        clearTimeout(_dashDebounceTimer);
        _dashDebounceTimer = setTimeout(renderDashboardDados, 280);
    }

    function atualizarDashboard(){
        if(!document.getElementById("dashBusca")) return;
        renderDashboardDados();
    }

    (function initDashboardUI(){
        const reagir = ["dashDim1","dashTipo1","dashDim2","dashTipo2","dashMetrica1","dashMetrica2"];
        reagir.forEach(id => {
            const n = document.getElementById(id);
            if(n) n.addEventListener("change", () => {
                if(document.getElementById("dashBusca")) renderDashboardDados();
            });
        });
        const busca = document.getElementById("dashBusca");
        if(busca) {
            busca.addEventListener("input", () => {
                renderDashboardDadosDebounced();
            });
        }
    })();

    // ---------------- GESTÃO DE AVULSAS ----------------
    function renderAvulsas() {
        const tbody = document.getElementById("listaAvulsas");
        if (!tbody) return;
        
        // 1. Filtra apenas caixas que estão como Avulsas e não têm endereço
        const avulsas = db.caixas.filter(c => c.status === "Avulsa" && (!c.prateleira || !c.prateleira.trim()));

        if (avulsas.length === 0) {
            tbody.innerHTML = "<tr><td colspan='4'>Nenhuma caixa avulsa encontrada.</td></tr>";
            // Limpa a paginação se a lista ficar vazia
            const container = document.getElementById("paginacaoAvulsasContainer");
            if(container) container.innerHTML = "";
            return;
        }

        // 2. Lógica de Paginação
        const totalPaginas = Math.ceil(avulsas.length / itensPorPaginaAvulsas) || 1;
        if(paginaAtualAvulsas > totalPaginas) paginaAtualAvulsas = totalPaginas;
        if(paginaAtualAvulsas < 1) paginaAtualAvulsas = 1;

        const inicio = (paginaAtualAvulsas - 1) * itensPorPaginaAvulsas;
        const fim = inicio + itensPorPaginaAvulsas;
        const avulsasPagina = avulsas.slice(inicio, fim);

        // 3. Renderiza apenas as 50 caixas da página atual
        tbody.innerHTML = "";
        avulsasPagina.forEach(c => {
            const idxReal = db.caixas.indexOf(c);
            tbody.innerHTML += `<tr>
                <td><b>${escModal(c.caixa)}</b></td>
                <td>${escModal(c.unidade || "—")}</td>
                <td><span class="badge" style="background:${getColor(c.status)}">${c.status}</span></td>
                <td><button class="btn-editar" onclick="editar(${idxReal})">Escolher Prateleira</button></td>
            </tr>`;
        });

        // 4. Desenha a barra de paginação
        renderizarPaginacaoAvulsas(avulsas.length, totalPaginas);
    }

    async function alocarTudoAutomatico() {
        const avulsasShort = db.caixas.filter(c => c.status === "Avulsa" && (!c.prateleira || !c.prateleira.trim()) && c.status !== "Eliminada");

        if (avulsasShort.length === 0) return alert("Não há caixas avulsas para alocar.");
        if (db.prateleiras.length === 0) return alert("Cadastre ao menos uma prateleira primeiro.");

        mostrarCarregamento("Alocando caixas…");
        let alocadasCont = 0;
        let logs = [];
        const caixasModificadas = [];

        for (let cShort of avulsasShort) {
            let alocada = false;
            let c = await carregarDetalhesCaixa(cShort.caixa, cShort.prateleira, cShort.status) || cShort;
            
            for (let p of db.prateleiras) {
                for (let n = 1; n <= 13; n++) {
                    for (let e = 1; e <= 6; e++) {
                        const ocupado = db.caixas.some(cx => caixaOcupaSlot(cx) && cx.prateleira === p.nome && cx.nivel === n && cx.espaco === e);
                        if (!ocupado) {
                            const antesLocal = "Avulsa";
                            c.prateleira = p.nome; 
                            c.nivel = n;
                            c.espaco = e;
                            c.status = "Guardada";
                            c.dataUpdate = new Date().toLocaleString();
                            
                            const mudanca = [{ campo: "localizacao", label: "Localização", de: antesLocal, para: formatarLocalCaixa(c) }];
                            if(!Array.isArray(c.historico)) c.historico = [];
                            c.historico.push(criarEntradaHistorico("edicao", mudanca, "Sistema (Auto)"));
                            
                            logs.push(`Caixa ${c.caixa} -> ${p.nome} (N${n}-S${e})`);
                            alocada = true;
                            alocadasCont++;
                            caixasModificadas.push(c);
                            break;
                        }
                    }
                    if (alocada) break;
                }
                if (alocada) break;
            }
            if (!alocada) break; 
        }

        if (alocadasCont > 0) {
            try {
                await salvarDB({ caixas: caixasModificadas, msgCarregamento: "Salvando alocações…" });
                atualizarInterface();
                alert(`Sucesso! ${alocadasCont} caixa(s) foram alocadas automaticamente.`);
            } finally {
                esconderCarregamento();
            }
        } else {
            esconderCarregamento();
            alert("Não foi possível alocar. Verifique se há espaço disponível nas prateleiras.");
        }
    }

    function voltarPagina() {
      if (window.history.length > 1) {
            window.history.back();
      } else {
        window.location.href = 'index.html'; 
        }
    }

    function gerarRelatorioLocalizacao() {
        const caixasComLocal = db.caixas
            .filter(c => {
                const temLocal = c.prateleira && c.prateleira.trim() !== "";
                return temLocal && c.status !== "Eliminada";
            })
            .sort((a, b) => (a.prateleira || "").localeCompare(b.prateleira || "") || a.nivel - b.nivel || a.espaco - b.espaco);

        let html = `<h3>Relatório de Localização de Estoque</h3>
                    <table style="font-size: 12px; width: 100%;">
                        <thead><tr><th>Endereço</th><th>Caixa</th><th>Unidade</th><th>Status</th></tr></thead>
                        <tbody>`;

        caixasComLocal.forEach(c => {
            html += `<tr>
                <td>${formatarLocalCaixa(c)}</td>
                <td>${escModal(c.caixa)}</td>
                <td>${escModal(c.unidade || "—")}</td>
                <td>${c.status}</td>
            </tr>`;
        });

        html += `</tbody></table>`;
        
        abrirModal(html, {
            wide: true,
            footer: '<button type="button" class="btn-sec" onclick="window.print()">Imprimir Relatório</button><button type="button" class="btn-prim" onclick="fecharModal()">Fechar</button>'
        });
    }

    // ---------------- PAGINAÇÃO ----------------
    function renderizarPaginacao(totalItens, totalPaginas) {
        let container = document.getElementById("paginacaoContainer");
        
        if (!container) {
            const table = document.querySelector("table");
            if(table) {
                container = document.createElement("div");
                container.id = "paginacaoContainer";
                container.className = "paginacao-container";
                table.parentNode.insertBefore(container, table.nextSibling);
            } else return;
        }

        if (totalItens === 0) {
            container.innerHTML = "<span class='paginacao-info'>Nenhuma caixa encontrada com este filtro.</span>";
            return;
        }

        const mostrandoInicio = (paginaAtual - 1) * itensPorPagina + 1;
        const mostrandoFim = Math.min(paginaAtual * itensPorPagina, totalItens);

        let html = `<span class='paginacao-info'>Mostrando ${mostrandoInicio} a ${mostrandoFim} de <b>${totalItens}</b> caixas</span>`;
        
        html += `<div class='paginacao-botoes'>`;
        html += `<button onclick="mudarPagina(1)" ${paginaAtual === 1 ? 'disabled' : ''}>&laquo; Prim</button>`;
        html += `<button onclick="mudarPagina(${paginaAtual - 1})" ${paginaAtual === 1 ? 'disabled' : ''}>&lsaquo; Ant</button>`;
        
        html += `<span class='paginacao-atual'>Pág ${paginaAtual} de ${totalPaginas}</span>`;

        html += `<button onclick="mudarPagina(${paginaAtual + 1})" ${paginaAtual === totalPaginas ? 'disabled' : ''}>Próx &rsaquo;</button>`;
        html += `<button onclick="mudarPagina(${totalPaginas})" ${paginaAtual === totalPaginas ? 'disabled' : ''}>Últ &raquo;</button>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    function mudarPagina(novaPagina) {
        paginaAtual = novaPagina;
        listar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ---------------- PAGINAÇÃO DO MAPA DE PRATELEIRAS ----------------
    function renderizarPaginacaoMapa(totalItens, totalPaginas) {
        let container = document.getElementById("paginacaoMapaContainer");
        
        if (!container) {
            const mapaDiv = document.getElementById("mapa");
            if(mapaDiv) {
                container = document.createElement("div");
                container.id = "paginacaoMapaContainer";
                container.className = "paginacao-container"; // Usa o mesmo CSS bonito!
                mapaDiv.parentNode.insertBefore(container, mapaDiv.nextSibling);
            } else return;
        }

        if (totalItens === 0) {
            container.innerHTML = "<span class='paginacao-info'>Nenhuma prateleira cadastrada.</span>";
            return;
        }

        const mostrandoInicio = (paginaAtualMapa - 1) * prateleirasPorPagina + 1;
        const mostrandoFim = Math.min(paginaAtualMapa * prateleirasPorPagina, totalItens);

        let html = `<span class='paginacao-info'>Mostrando prateleiras ${mostrandoInicio} a ${mostrandoFim} de <b>${totalItens}</b></span>`;
        
        html += `<div class='paginacao-botoes'>`;
        html += `<button onclick="mudarPaginaMapa(1)" ${paginaAtualMapa === 1 ? 'disabled' : ''}>&laquo; Prim</button>`;
        html += `<button onclick="mudarPaginaMapa(${paginaAtualMapa - 1})" ${paginaAtualMapa === 1 ? 'disabled' : ''}>&lsaquo; Ant</button>`;
        
        html += `<span class='paginacao-atual'>Pág ${paginaAtualMapa} de ${totalPaginas}</span>`;

        html += `<button onclick="mudarPaginaMapa(${paginaAtualMapa + 1})" ${paginaAtualMapa === totalPaginas ? 'disabled' : ''}>Próx &rsaquo;</button>`;
        html += `<button onclick="mudarPaginaMapa(${totalPaginas})" ${paginaAtualMapa === totalPaginas ? 'disabled' : ''}>Últ &raquo;</button>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    function mudarPaginaMapa(novaPagina) {
        paginaAtualMapa = novaPagina;
        mapa();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ---------------- PAGINAÇÃO DE AVULSAS ----------------
    function renderizarPaginacaoAvulsas(totalItens, totalPaginas) {
        let container = document.getElementById("paginacaoAvulsasContainer");
        
        if (!container) {
            const tbody = document.getElementById("listaAvulsas");
            if(tbody && tbody.closest("table")) {
                const table = tbody.closest("table");
                container = document.createElement("div");
                container.id = "paginacaoAvulsasContainer";
                container.className = "paginacao-container"; // Usa o seu CSS bonitão automaticamente!
                table.parentNode.insertBefore(container, table.nextSibling);
            } else return;
        }

        if (totalItens === 0) return;

        const mostrandoInicio = (paginaAtualAvulsas - 1) * itensPorPaginaAvulsas + 1;
        const mostrandoFim = Math.min(paginaAtualAvulsas * itensPorPaginaAvulsas, totalItens);

        let html = `<span class='paginacao-info'>Mostrando ${mostrandoInicio} a ${mostrandoFim} de <b>${totalItens}</b> avulsas</span>`;
        
        html += `<div class='paginacao-botoes'>`;
        html += `<button onclick="mudarPaginaAvulsas(1)" ${paginaAtualAvulsas === 1 ? 'disabled' : ''}>&laquo; Prim</button>`;
        html += `<button onclick="mudarPaginaAvulsas(${paginaAtualAvulsas - 1})" ${paginaAtualAvulsas === 1 ? 'disabled' : ''}>&lsaquo; Ant</button>`;
        
        html += `<span class='paginacao-atual'>Pág ${paginaAtualAvulsas} de ${totalPaginas}</span>`;

        html += `<button onclick="mudarPaginaAvulsas(${paginaAtualAvulsas + 1})" ${paginaAtualAvulsas === totalPaginas ? 'disabled' : ''}>Próx &rsaquo;</button>`;
        html += `<button onclick="mudarPaginaAvulsas(${totalPaginas})" ${paginaAtualAvulsas === totalPaginas ? 'disabled' : ''}>Últ &raquo;</button>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    function mudarPaginaAvulsas(novaPagina) {
        paginaAtualAvulsas = novaPagina;
        renderAvulsas();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // Função acionada ao digitar na busca do Mapa
    function buscarNoMapa() {
        paginaAtualMapa = 1; // Volta para a primeira página dos resultados
        mapa(); 
    }
    function preencherFiltrosListaCaixas() {
        // 1. Preenche o Select de Processos
        const selProc = document.getElementById("filtroProcessoLista");
        if (selProc) {
            const valorProc = selProc.value;
            selProc.innerHTML = '<option value="">— Todos os Processos —</option>';
            db.processos.forEach(p => {
                const opt = document.createElement("option");
                opt.value = p; opt.textContent = p;
                selProc.appendChild(opt);
            });
            if([...selProc.options].some(o => o.value === valorProc)) selProc.value = valorProc;
        }

        // 2. Preenche o Select de Unidades
        const selUnid = document.getElementById("filtroUnidadeLista");
        if (selUnid) {
            const valorUnid = selUnid.value;
            selUnid.innerHTML = '<option value="">— Todas as Unidades —</option>';
            
            // Formata igual no Dashboard (Número - Nome)
            let opcoesFormatadas = (db.unidades || []).map(u => {
                if(typeof u === 'string') return u;
                return `${u.numero} - ${u.nome}`;
            });
            
            opcoesFormatadas.sort((a, b) => a.localeCompare(b, "pt")).forEach(u => {
                const opt = document.createElement("option");
                opt.value = u; opt.textContent = u;
                selUnid.appendChild(opt);
            });
            if([...selUnid.options].some(o => o.value === valorUnid)) selUnid.value = valorUnid;
        }
    }

    // ---------------- PAGINAÇÃO DE CONFIGURAÇÃO DE PRATELEIRAS ----------------
    function renderizarPaginacaoConfigPrat(totalItens, totalPaginas) {
        let container = document.getElementById("paginacaoConfigPratContainer");
        
        if (!container) {
            const tbody = document.getElementById("listaPrateleirasConfig");
            if(tbody && tbody.closest("table")) {
                const table = tbody.closest("table");
                container = document.createElement("div");
                container.id = "paginacaoConfigPratContainer";
                container.className = "paginacao-container"; 
                table.parentNode.insertBefore(container, table.nextSibling);
            } else return;
        }

        if (totalItens === 0) {
            container.innerHTML = ""; return;
        }

        const mostrandoInicio = (paginaAtualConfigPrat - 1) * itensPorPaginaConfigPrat + 1;
        const mostrandoFim = Math.min(paginaAtualConfigPrat * itensPorPaginaConfigPrat, totalItens);

        let html = `<span class='paginacao-info'>Mostrando ${mostrandoInicio} a ${mostrandoFim} de <b>${totalItens}</b> prateleiras</span>`;
        
        html += `<div class='paginacao-botoes'>`;
        html += `<button onclick="mudarPaginaConfigPrat(1)" ${paginaAtualConfigPrat === 1 ? 'disabled' : ''}>&laquo; Prim</button>`;
        html += `<button onclick="mudarPaginaConfigPrat(${paginaAtualConfigPrat - 1})" ${paginaAtualConfigPrat === 1 ? 'disabled' : ''}>&lsaquo; Ant</button>`;
        
        html += `<span class='paginacao-atual'>Pág ${paginaAtualConfigPrat} de ${totalPaginas}</span>`;

        html += `<button onclick="mudarPaginaConfigPrat(${paginaAtualConfigPrat + 1})" ${paginaAtualConfigPrat === totalPaginas ? 'disabled' : ''}>Próx &rsaquo;</button>`;
        html += `<button onclick="mudarPaginaConfigPrat(${totalPaginas})" ${paginaAtualConfigPrat === totalPaginas ? 'disabled' : ''}>Últ &raquo;</button>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    function mudarPaginaConfigPrat(novaPagina) {
        paginaAtualConfigPrat = novaPagina;
        renderConfigPrateleiras();
    }

    // ---------------- PREPARAÇÃO DE CAIXAS (Preparador Chefe) ----------------
    let caixasSelecionadasParaPreparo = [];

    function renderizarCaixasSelecionadas() {
        const container = document.getElementById("caixasSelecionadasContainer");
        if (!container) return;
        container.innerHTML = "";
        caixasSelecionadasParaPreparo.forEach((caixa, idx) => {
            const pill = document.createElement("div");
            pill.style.cssText = "background: #f1f2f6; border: 1px solid #dcdde1; border-radius: 16px; padding: 6px 12px; display: flex; align-items: center; gap: 8px; font-size: 14px;";
            pill.innerHTML = `
                <span>${caixa}</span>
                <span style="cursor: pointer; color: #e74c3c; font-weight: bold;" onclick="removerCaixaPreparo(${idx})">&times;</span>
            `;
            container.appendChild(pill);
        });
    }

    function adicionarCaixaPreparo() {
        const input = document.getElementById("prepCaixaNumero");
        const msg = document.getElementById("prepMensagem");
        const val = input.value.trim();

        if (!val) return false;

        if (caixasSelecionadasParaPreparo.some(c => c.toLowerCase() === val.toLowerCase())) {
            msg.style.color = "#e67e22";
            msg.textContent = "Esta caixa já está na lista!";
            return false;
        }

        const caixaObj = db.caixas && db.caixas.find(c => c.caixa.toLowerCase() === val.toLowerCase());
        if (!caixaObj) {
            msg.style.color = "#e74c3c";
            msg.textContent = "Caixa não encontrada no sistema!";
            return false;
        }
        if (caixaObj.status !== "Guardada") {
            msg.style.color = "#e74c3c";
            msg.textContent = "Apenas caixas com status 'Guardada' podem ser preparadas!";
            return false;
        }

        caixasSelecionadasParaPreparo.push(val);
        input.value = "";
        input.focus();
        msg.textContent = "";
        renderizarCaixasSelecionadas();
        return true;
    }
    function removerCaixaPreparo(idx) {
        caixasSelecionadasParaPreparo.splice(idx, 1);
        renderizarCaixasSelecionadas();
    }

    function atualizarTelaPreparacao() {
        const selFunc = document.getElementById("prepFuncionarioSelect");
        if (!selFunc) return;

        selFunc.innerHTML = '<option value="">— Selecione o Preparador —</option>';
        if (db.responsaveis) {
            const preparadores = db.responsaveis.filter(r => r.funcao === "Preparador" || r.funcao === "Preparador Chefe").map(r => r.nome).sort();
            preparadores.forEach(nome => {
                const opt = document.createElement("option");
                opt.value = nome;
                opt.textContent = nome;
                selFunc.appendChild(opt);
            });
        }

        const datalistCaixas = document.getElementById("listaCaixasParaPreparo");
        if (datalistCaixas && db.caixas) {
            datalistCaixas.innerHTML = "";
            const fragment = document.createDocumentFragment();
            db.caixas.forEach(c => {
                if (c.status === "Guardada") {
                    const opt = document.createElement("option");
                    opt.value = c.caixa;
                    fragment.appendChild(opt);
                }
            });
            datalistCaixas.appendChild(fragment);
        }
        renderizarCaixasSelecionadas();
    }

    async function registrarCaixaPreparada(event) {
        event.preventDefault();
        const funcionario = document.getElementById("prepFuncionarioSelect").value;
        const msg = document.getElementById("prepMensagem");
        const btnSubmit = event.target.querySelector("button[type='submit']");
        
        const inputNumCaixa = document.getElementById("prepCaixaNumero").value.trim();
        if (inputNumCaixa && caixasSelecionadasParaPreparo.length === 0) {
            const added = adicionarCaixaPreparo();
            if (added === false) return;
        }

        if (caixasSelecionadasParaPreparo.length === 0) {
            msg.style.color = "#e74c3c";
            msg.textContent = "Adicione ao menos uma caixa para registrar.";
            return;
        }

        if (!funcionario) {
            msg.style.color = "#e74c3c";
            msg.textContent = "Selecione o funcionário.";
            return;
        }

        if (btnSubmit) btnSubmit.disabled = true;
        msg.style.color = "#3498db";
        msg.textContent = "Processando... aguarde.";

        try {
            let alteradas = 0;
            let naoEncontradas = [];
            const caixasModificadas = [];

            for (const numCaixa of caixasSelecionadasParaPreparo) {
                const idx = db.caixas.findIndex(c => c.caixa.toLowerCase() === numCaixa.toLowerCase());
                
                if (idx === -1) {
                    naoEncontradas.push(numCaixa);
                    continue;
                }

                const caixaShort = db.caixas[idx];
                const caixa = await carregarDetalhesCaixa(caixaShort.caixa, caixaShort.prateleira, caixaShort.status) || caixaShort;
                const antes = snapshotCaixaParaHistorico(caixa);

                caixa.status = "Preparada";
                caixa.usuario = funcionario;
                caixa.dataUpdate = new Date().toLocaleString();

                const mud = extrairMudancasRegistro(antes, caixa);
                if (mud.length > 0) {
                    if (!Array.isArray(caixa.historico)) caixa.historico = [];
                    let registradoPor = "";
                    try {
                        const uStr = sessionStorage.getItem("usuarioLogado");
                        const u = uStr ? JSON.parse(uStr) : null;
                        registradoPor = (u && u.nome) ? u.nome : "Preparador Chefe";
                    } catch(e) {}
                    
                    caixa.historico.push(criarEntradaHistorico("edicao", mud, registradoPor));
                }
                caixasModificadas.push(caixa);
                alteradas++;
            }

            if (alteradas > 0) {
                await salvarDB({ caixas: caixasModificadas });
                if (typeof confetti === 'function') {
                    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                }
            }
            
            caixasSelecionadasParaPreparo = [];
            renderizarCaixasSelecionadas();
            document.getElementById("prepCaixaNumero").value = "";
            document.getElementById("prepCaixaNumero").focus();
            
            if (naoEncontradas.length > 0) {
                msg.style.color = "#e67e22";
                msg.textContent = `${alteradas} caixa(s) registrada(s). Não encontradas: ${naoEncontradas.join(', ')}`;
            } else {
                msg.style.color = "#27ae60";
                msg.textContent = `${alteradas} caixa(s) marcada(s) como Preparada(s) por ${funcionario} com sucesso!`;
            }
        } catch (error) {
            console.error(error);
            msg.style.color = "#e74c3c";
            msg.textContent = "Erro ao registrar: Verifique o acesso à pasta selecionada e tente novamente.";
        } finally {
            if (btnSubmit) btnSubmit.disabled = false;
        }
    }

    // ---------------- DIGITALIZAÇÃO DE CAIXAS ----------------
    let caixasSelecionadasParaDigitalizar = [];

    function renderizarCaixasSelecionadasDig() {
        const container = document.getElementById("caixasSelecionadasContainerDig");
        if (!container) return;
        container.innerHTML = "";
        caixasSelecionadasParaDigitalizar.forEach((caixa, idx) => {
            const pill = document.createElement("div");
            pill.style.cssText = "background: #f1f2f6; border: 1px solid #dcdde1; border-radius: 16px; padding: 6px 12px; display: flex; align-items: center; gap: 8px; font-size: 14px;";
            pill.innerHTML = `
                <span>${caixa}</span>
                <span style="cursor: pointer; color: #e74c3c; font-weight: bold;" onclick="removerCaixaDigitalizacao(${idx})">&times;</span>
            `;
            container.appendChild(pill);
        });
    }

    function adicionarCaixaDigitalizacao() {
        const input = document.getElementById("digCaixaNumero");
        const msg = document.getElementById("digMensagem");
        const val = input.value.trim();

        if (!val) return false;

        if (caixasSelecionadasParaDigitalizar.some(c => c.toLowerCase() === val.toLowerCase())) {
            msg.style.color = "#e67e22";
            msg.textContent = "Esta caixa já está na lista!";
            return false;
        }

        const caixaObj = db.caixas && db.caixas.find(c => c.caixa.toLowerCase() === val.toLowerCase());
        if (!caixaObj) {
            msg.style.color = "#e74c3c";
            msg.textContent = "Caixa não encontrada no sistema!";
            return false;
        }
        if (caixaObj.status !== "Preparada") {
            msg.style.color = "#e74c3c";
            msg.textContent = "Apenas caixas com status 'Preparada' podem ser digitalizadas!";
            return false;
        }

        caixasSelecionadasParaDigitalizar.push(val);
        input.value = "";
        input.focus();
        msg.textContent = "";
        renderizarCaixasSelecionadasDig();
        return true;
    }

    function removerCaixaDigitalizacao(idx) {
        caixasSelecionadasParaDigitalizar.splice(idx, 1);
        renderizarCaixasSelecionadasDig();
    }

    function atualizarTelaDigitalizacao() {
        const datalistCaixas = document.getElementById("listaCaixasParaDigitalizar");
        if (datalistCaixas && db.caixas) {
            datalistCaixas.innerHTML = "";
            const fragment = document.createDocumentFragment();
            db.caixas.forEach(c => {
                if (c.status === "Preparada") {
                    const opt = document.createElement("option");
                    opt.value = c.caixa;
                    fragment.appendChild(opt);
                }
            });
            datalistCaixas.appendChild(fragment);
        }
        renderizarCaixasSelecionadasDig();
    }

    async function registrarCaixaDigitalizada(event) {
        event.preventDefault();

        let funcionario = "Digitalizador";
        try {
            const uStr = sessionStorage.getItem("usuarioLogado");
            const u = uStr ? JSON.parse(uStr) : null;
            if (u && u.nome) {
                funcionario = u.nome;
            }
        } catch(e) {}

        const msg = document.getElementById("digMensagem");
        const btnSubmit = event.target.querySelector("button[type='submit']");

        const inputNumCaixa = document.getElementById("digCaixaNumero").value.trim();
        if (inputNumCaixa && caixasSelecionadasParaDigitalizar.length === 0) {
            const added = adicionarCaixaDigitalizacao();
            if (added === false) return; // Validation failed, error msg is already set
        }

        const qtdDocsInput = document.getElementById("digQtdDocs");
        const totalDocsValue = (qtdDocsInput && qtdDocsInput.value) ? parseInt(qtdDocsInput.value, 10) : 0;

        if (caixasSelecionadasParaDigitalizar.length === 0) {
            if (totalDocsValue > 0) {
                if (btnSubmit) btnSubmit.disabled = true;
                msg.style.color = "#3498db";
                msg.textContent = "Processando registro avulso de documentos... aguarde.";

                try {
                    const nomeCaixaAvulsa = `[Avulso] - Doc. ${new Date().getTime().toString().slice(-6)}`;
                    const novaCaixa = {
                        caixa: nomeCaixaAvulsa,
                        status: "Digitalizada",
                        prateleira: "",
                        processos: [],
                        unidade: "",
                        observacoes: "Registro avulso de documentos digitalizados.",
                        usuario: funcionario,
                        dataUpdate: new Date().toLocaleString(),
                        documentos: totalDocsValue,
                        historico: []
                    };
                    
                    let registradoPor = "";
                    try {
                        const uStr = sessionStorage.getItem("usuarioLogado");
                        const u = uStr ? JSON.parse(uStr) : null;
                        registradoPor = (u && u.nome) ? u.nome : "Digitalizador";
                    } catch(e) {}
                    
                    novaCaixa.historico.push({
                        quandoISO: new Date().toISOString(),
                        quandoAmigavel: new Date().toLocaleString(),
                        registradoPor: registradoPor,
                        acao: "criacao",
                        detalhes: "Registro Avulso",
                        mudancas: []
                    });
                    
                    novaCaixa.historico.push({
                        quandoISO: new Date().toISOString(),
                        quandoAmigavel: new Date().toLocaleString(),
                        registradoPor: registradoPor,
                        acao: "edicao",
                        detalhes: "Edição de campos",
                        mudancas: [
                            { campo: "status", label: "Status", de: "Preparada", para: "Digitalizada" },
                            { campo: "documentos", label: "Qtd. Documentos", de: "0", para: String(totalDocsValue) }
                        ]
                    });

                    db.caixas.push(novaCaixa);
                    await salvarDB({ caixas: [novaCaixa] });
                    
                    if (typeof confetti === 'function') {
                        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                    }
                    
                    if (qtdDocsInput) qtdDocsInput.value = "";
                    document.getElementById("digCaixaNumero").value = "";
                    document.getElementById("digCaixaNumero").focus();

                    msg.style.color = "#27ae60";
                    msg.textContent = `${totalDocsValue} documento(s) avulso(s) registrado(s) com sucesso!`;
                } catch (e) {
                    msg.style.color = "#e74c3c";
                    msg.textContent = "Erro ao salvar: " + e.message;
                } finally {
                    if (btnSubmit) btnSubmit.disabled = false;
                }
                return;
            } else {
                msg.style.color = "#e74c3c";
                msg.textContent = "Adicione ao menos uma caixa ou informe a quantidade de documentos.";
                return;
            }
        }

        if (btnSubmit) btnSubmit.disabled = true;
        msg.style.color = "#3498db";
        msg.textContent = "Processando... aguarde.";

        try {
            let alteradas = 0;
            let naoEncontradas = [];

            const qtdDocsInput = document.getElementById("digQtdDocs");
            let baseDocs = 0;
            let remainder = 0;
            if (qtdDocsInput && qtdDocsInput.value) {
                const totalDocs = parseInt(qtdDocsInput.value, 10);
                const boxCount = caixasSelecionadasParaDigitalizar.length;
                baseDocs = Math.floor(totalDocs / boxCount);
                remainder = totalDocs % boxCount;
            }

            const caixasModificadas = [];
            // Distribute documents evenly across selected boxes
            for (let i = 0; i < caixasSelecionadasParaDigitalizar.length; i++) {
                const numCaixa = caixasSelecionadasParaDigitalizar[i];
                const idx = db.caixas.findIndex(c => c.caixa.toLowerCase() === numCaixa.toLowerCase());

                if (idx === -1) {
                    naoEncontradas.push(numCaixa);
                    continue;
                }

                const caixaShort = db.caixas[idx];
                const caixa = await carregarDetalhesCaixa(caixaShort.caixa, caixaShort.prateleira, caixaShort.status) || caixaShort;
                const antes = snapshotCaixaParaHistorico(caixa);

                // Determine documents for this box
                const docsForBox = baseDocs + (i < remainder ? 1 : 0);

                caixa.status = "Digitalizada";
                caixa.usuario = funcionario;
                caixa.dataUpdate = new Date().toLocaleString();
                if (docsForBox > 0) {
                    caixa.documentos = (caixa.documentos || 0) + docsForBox;
                }

                const mud = extrairMudancasRegistro(antes, caixa);
                if (docsForBox > 0) {
                    mud.push({ campo: "documentos", label: "Qtd. Documentos", de: "0", para: String(docsForBox) });
                }

                if (mud.length > 0) {
                    if (!Array.isArray(caixa.historico)) caixa.historico = [];
                    let registradoPor = "";
                    try {
                        const uStr = sessionStorage.getItem("usuarioLogado");
                        const u = uStr ? JSON.parse(uStr) : null;
                        registradoPor = (u && u.nome) ? u.nome : "Digitalizador";
                    } catch(e) {}

                    caixa.historico.push(criarEntradaHistorico("edicao", mud, registradoPor));
                }
                caixasModificadas.push(caixa);
                alteradas++;
            }

            if (alteradas > 0) {
                await salvarDB({ caixas: caixasModificadas });
                if (typeof confetti === 'function') {
                    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                }
            }

            caixasSelecionadasParaDigitalizar = [];
            renderizarCaixasSelecionadasDig();
            document.getElementById("digCaixaNumero").value = "";
            const mediaDocsInputReset = document.getElementById("digQtdDocs");
            if (mediaDocsInputReset) mediaDocsInputReset.value = "";
            document.getElementById("digCaixaNumero").focus();

            if (naoEncontradas.length > 0) {
                msg.style.color = "#e67e22";
                msg.textContent = `${alteradas} caixa(s) registrada(s). Não encontradas: ${naoEncontradas.join(', ')}`;
            } else {
                msg.style.color = "#27ae60";
                msg.textContent = `${alteradas} caixa(s) marcada(s) como Digitalizada(s) por ${funcionario} com sucesso!`;
            }
        } catch (error) {
            console.error(error);
            msg.style.color = "#e74c3c";
            msg.textContent = "Ocorreu um erro ao registrar as caixas.";
        } finally {
            if (btnSubmit) btnSubmit.disabled = false;
        }

        clearTimeout(window._digMsgT);
        window._digMsgT = setTimeout(() => { msg.textContent = ""; }, 4500);
    }
    // ---------------- RELAÇÃO DE CAIXAS ----------------
    function obterCaixasEmRelacao() {
        const set = new Set();
        (db.relacoes || []).forEach(rel => {
            if (Array.isArray(rel.caixas)) {
                rel.caixas.forEach(num => set.add(String(num)));
            }
        });
        return set;
    }

    function caixaEstaEmRelacao(numeroCaixa, emRelacaoSet) {
        return emRelacaoSet.has(String(numeroCaixa));
    }

    function caixaDisponivelParaRelacao(c, proc, emRelacaoSet) {
        if (c.status !== "Preparada") return false;
        if (!Array.isArray(c.processos) || !c.processos.includes(proc)) return false;
        return !caixaEstaEmRelacao(c.caixa, emRelacaoSet);
    }

    function atualizarTelaRelacao() {
        if (ERP_PAGE_ID !== "relacao") return;

        const selProc = document.getElementById("relProcessoSelect");
        const selDig = document.getElementById("relDigitalizadorSelect");
        const selFiltroDig = document.getElementById("filtroDigitalizadorRel");

        if (!selProc || !selDig) return;

        // Limpar selects
        selProc.innerHTML = '<option value="">— Selecione o Processo —</option>';
        selDig.innerHTML = '<option value="">— Selecione o Digitalizador —</option>';
        if (selFiltroDig) {
            selFiltroDig.innerHTML = '<option value="">Todos</option>';
        }

        // Preencher Processos que possuem caixas preparadas disponíveis (sem relação)
        const emRelacao = obterCaixasEmRelacao();
        const processosComPreparadas = new Set();
        db.caixas.forEach(c => {
            if (c.status === "Preparada" && Array.isArray(c.processos) && !caixaEstaEmRelacao(c.caixa, emRelacao)) {
                c.processos.forEach(p => processosComPreparadas.add(p));
            }
        });

        if (db.processos) {
            db.processos.forEach(p => {
                if (processosComPreparadas.has(p)) {
                    const opt = document.createElement("option");
                    opt.value = p;
                    opt.textContent = p;
                    selProc.appendChild(opt);
                }
            });
        }

        // Preencher Digitalizadores
        if (db.responsaveis) {
            db.responsaveis.forEach(r => {
                if (r.funcao === "Digitalizador" || r.funcao === "Administrador") {
                    const opt = document.createElement("option");
                    opt.value = r.nome;
                    opt.textContent = r.nome + " (" + r.funcao + ")";
                    selDig.appendChild(opt);
                    
                    if (selFiltroDig) {
                        const optFiltro = document.createElement("option");
                        optFiltro.value = r.nome;
                        optFiltro.textContent = r.nome;
                        selFiltroDig.appendChild(optFiltro);
                    }
                }
            });
        }

        atualizarQuantidadeDisponivel();
        if (typeof renderizarHistoricoRelacoes === 'function') {
            renderizarHistoricoRelacoes(true);
        }
    }

    function atualizarQuantidadeDisponivel() {
        const selProc = document.getElementById("relProcessoSelect");
        const qtdInfo = document.getElementById("relQtdDisponivel");
        const inputQtd = document.getElementById("relQtdInput");
        const btnGerar = document.getElementById("btnGerar");
        
        if (!selProc || !qtdInfo) return;

        const proc = selProc.value;
        if (!proc) {
            qtdInfo.textContent = "Selecione um processo para ver a disponibilidade.";
            inputQtd.disabled = true;
            inputQtd.value = "";
            btnGerar.disabled = true;
            const aviso = document.getElementById("relQtdAviso");
            if (aviso) {
                aviso.textContent = "";
                aviso.style.display = "none";
            }
            return;
        }

        const emRelacao = obterCaixasEmRelacao();
        const caixasPreparadasProc = db.caixas.filter(c =>
            c.status === "Preparada" && Array.isArray(c.processos) && c.processos.includes(proc)
        );
        const qtdDisponivel = caixasPreparadasProc.filter(c => !caixaEstaEmRelacao(c.caixa, emRelacao)).length;
        const qtdEmRelacao = caixasPreparadasProc.length - qtdDisponivel;

        if (qtdEmRelacao > 0) {
            qtdInfo.textContent = `Caixas disponíveis para nova relação: ${qtdDisponivel} (${qtdEmRelacao} já em outra relação)`;
        } else {
            qtdInfo.textContent = `Caixas preparadas disponíveis neste processo: ${qtdDisponivel}`;
        }
        
        if (qtdDisponivel > 0) {
            inputQtd.disabled = false;
            inputQtd.max = qtdDisponivel;
            validarQuantidadeRelacao();
        } else {
            inputQtd.disabled = true;
            inputQtd.value = "";
            btnGerar.disabled = true;
            const aviso = document.getElementById("relQtdAviso");
            if (aviso) {
                aviso.textContent = "";
                aviso.style.display = "none";
            }
        }
    }

    function validarQuantidadeRelacao() {
        const selProc = document.getElementById("relProcessoSelect");
        const inputQtd = document.getElementById("relQtdInput");
        const btnGerar = document.getElementById("btnGerar");
        const aviso = document.getElementById("relQtdAviso");

        if (!selProc || !inputQtd || inputQtd.disabled) return;

        const proc = selProc.value;
        if (!proc) {
            if (aviso) {
                aviso.textContent = "";
                aviso.style.display = "none";
            }
            if (btnGerar) btnGerar.disabled = true;
            return;
        }

        const emRelacao = obterCaixasEmRelacao();
        const qtdDisponivel = db.caixas.filter(c => caixaDisponivelParaRelacao(c, proc, emRelacao)).length;
        const qtdDesejada = parseInt(inputQtd.value, 10);

        if (!isNaN(qtdDesejada) && qtdDesejada > qtdDisponivel) {
            const texto = `Atenção: você solicitou ${qtdDesejada} caixa(s), mas o processo possui apenas ${qtdDisponivel} disponível(eis) para nova relação. Reduza a quantidade ou escolha outro processo.`;
            if (aviso) {
                aviso.textContent = texto;
                aviso.style.display = "block";
            }
            if (btnGerar) btnGerar.disabled = true;
            return;
        }

        if (aviso) {
            aviso.textContent = "";
            aviso.style.display = "none";
        }
        if (btnGerar) btnGerar.disabled = !qtdDisponivel || isNaN(qtdDesejada) || qtdDesejada <= 0;
    }

    window.validarQuantidadeRelacao = validarQuantidadeRelacao;

    function renderizarHistoricoRelacoes(resetPagina = false) {
        const tbody = document.getElementById("tbodyHistoricoRelacoes");
        const msgVazio = document.getElementById("historicoRelacoesMsg");
        const pagContainer = document.getElementById("paginacaoRelacoesContainer");
        
        if (!tbody || !msgVazio) return;

        if (resetPagina) paginaAtualRelacoes = 1;

        const filtroDig = document.getElementById("filtroDigitalizadorRel").value;
        const filtroDataIni = document.getElementById("filtroDataInicialRel").value;
        const filtroDataFim = document.getElementById("filtroDataFinalRel").value;

        tbody.innerHTML = "";
        if (pagContainer) pagContainer.innerHTML = "";
        
        if (!db.relacoes || db.relacoes.length === 0) {
            msgVazio.style.display = "block";
            return;
        }

        let relacoesFiltradas = db.relacoes.filter(rel => {
            if (filtroDig && rel.digitalizador !== filtroDig) return false;
            
            if (filtroDataIni || filtroDataFim) {
                const dataRel = new Date(rel.dataISO);
                dataRel.setHours(0,0,0,0);
                
                if (filtroDataIni) {
                    const dataIni = new Date(filtroDataIni + "T00:00:00");
                    if (dataRel < dataIni) return false;
                }
                if (filtroDataFim) {
                    const dataFim = new Date(filtroDataFim + "T00:00:00");
                    if (dataRel > dataFim) return false;
                }
            }
            return true;
        });

        relacoesFiltradas.sort((a, b) => new Date(b.dataISO) - new Date(a.dataISO));

        if (relacoesFiltradas.length === 0) {
            msgVazio.style.display = "block";
            return;
        }

        msgVazio.style.display = "none";

        const totalItens = relacoesFiltradas.length;
        const totalPaginas = Math.ceil(totalItens / itensPorPaginaRelacoes) || 1;
        if (paginaAtualRelacoes > totalPaginas) paginaAtualRelacoes = totalPaginas;
        if (paginaAtualRelacoes < 1) paginaAtualRelacoes = 1;

        const inicio = (paginaAtualRelacoes - 1) * itensPorPaginaRelacoes;
        const fim = inicio + itensPorPaginaRelacoes;
        const relacoesPagina = relacoesFiltradas.slice(inicio, fim);

        relacoesPagina.forEach(rel => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${new Date(rel.dataISO).toLocaleDateString()} ${new Date(rel.dataISO).toLocaleTimeString()}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${rel.processo}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${rel.digitalizador}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${rel.qtdCaixas}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                    <button type="button" onclick="visualizarRelacao('${rel.id}')" style="padding: 5px 10px; background-color: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Visualizar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        renderizarPaginacaoRelacoes(totalItens, totalPaginas);
    }

    function renderizarPaginacaoRelacoes(totalItens, totalPaginas) {
        const container = document.getElementById("paginacaoRelacoesContainer");
        if (!container) return;

        if (totalItens === 0) {
            container.innerHTML = "";
            return;
        }

        const mostrandoInicio = (paginaAtualRelacoes - 1) * itensPorPaginaRelacoes + 1;
        const mostrandoFim = Math.min(paginaAtualRelacoes * itensPorPaginaRelacoes, totalItens);

        let html = `<span class='paginacao-info'>Mostrando ${mostrandoInicio} a ${mostrandoFim} de <b>${totalItens}</b> relações</span>`;
        html += `<div class='paginacao-botoes'>`;
        html += `<button onclick="mudarPaginaRelacoes(1)" ${paginaAtualRelacoes === 1 ? 'disabled' : ''}>&laquo; Prim</button>`;
        html += `<button onclick="mudarPaginaRelacoes(${paginaAtualRelacoes - 1})" ${paginaAtualRelacoes === 1 ? 'disabled' : ''}>&lsaquo; Ant</button>`;
        html += `<span class='paginacao-atual'>Pág ${paginaAtualRelacoes} de ${totalPaginas}</span>`;
        html += `<button onclick="mudarPaginaRelacoes(${paginaAtualRelacoes + 1})" ${paginaAtualRelacoes === totalPaginas ? 'disabled' : ''}>Próx &rsaquo;</button>`;
        html += `<button onclick="mudarPaginaRelacoes(${totalPaginas})" ${paginaAtualRelacoes === totalPaginas ? 'disabled' : ''}>Últ &raquo;</button>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    function mudarPaginaRelacoes(novaPagina) {
        paginaAtualRelacoes = novaPagina;
        renderizarHistoricoRelacoes();
        const historico = document.getElementById("tabelaHistoricoRelacoes");
        if (historico) historico.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function limparFiltrosRelacoes() {
        document.getElementById("filtroDigitalizadorRel").value = "";
        document.getElementById("filtroDataInicialRel").value = "";
        document.getElementById("filtroDataFinalRel").value = "";
        renderizarHistoricoRelacoes(true);
    }

    window.imprimirRelacao = function(id) {
        const rel = db.relacoes.find(r => r.id === id);
        if (!rel) return;
        
        const caixasLista = Array.isArray(rel.caixas) ? rel.caixas : [];
        let trs = "";
        caixasLista.forEach(numeroCaixa => {
            const c = db.caixas.find(cx => cx.caixa === numeroCaixa);
            let dataCriacao = "—";
            if (c && Array.isArray(c.historico) && c.historico.length > 0) {
                const criacaoHist = c.historico.find(h => h.tipo === "criacao" || h.acao === "criacao");
                if (criacaoHist && criacaoHist.quandoISO) {
                    dataCriacao = new Date(criacaoHist.quandoISO).toLocaleString("pt-BR");
                } else if (c.historico[0].quandoISO) {
                    dataCriacao = new Date(c.historico[0].quandoISO).toLocaleString("pt-BR");
                }
            }
            trs += `<tr>
                <td>${numeroCaixa}</td>
                <td>${c ? (c.unidade || '—') : '—'}</td>
                <td>${c ? formatarLocalCaixa(c) : '—'}</td>
                <td>${dataCriacao}</td>
            </tr>`;
        });

        const htmlPrint = `
            <h3>Relação de Caixas para Digitalização</h3>
            <p><strong>Digitalizador Destino:</strong> ${rel.digitalizador}</p>
            <p><strong>Processo:</strong> ${rel.processo}</p>
            <p><strong>Data de Geração:</strong> ${new Date(rel.dataISO).toLocaleString()}</p>
            <table class="tabela">
                <thead><tr><th>Caixa</th><th>Unidade</th><th>Localização</th><th>Data de Criação</th></tr></thead>
                <tbody>${trs}</tbody>
            </table>
        `;
        
        const win = window.open("", "_blank");
        win.document.write(`
            <html>
            <head>
                <title>Impressão de Relação</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; color: #333; }
                    .tabela { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
                    .tabela th, .tabela td { border: 1px solid #ccc; padding: 10px; text-align: left; }
                    .tabela th { background: #f4f4f4; }
                </style>
            </head>
            <body onload="window.print(); window.close();">
                ${htmlPrint}
            </body>
            </html>
        `);
    };

    window.visualizarRelacao = function(id) {
        const rel = db.relacoes.find(r => r.id === id);
        if (!rel) return;

        const caixasLista = Array.isArray(rel.caixas) ? rel.caixas : [];
        let trs = "";
        
        caixasLista.forEach(numeroCaixa => {
            const c = db.caixas.find(cx => cx.caixa === numeroCaixa);
            let dataCriacao = "—";
            if (c && Array.isArray(c.historico) && c.historico.length > 0) {
                const criacaoHist = c.historico.find(h => h.tipo === "criacao" || h.acao === "criacao");
                if (criacaoHist && criacaoHist.quandoISO) {
                    dataCriacao = new Date(criacaoHist.quandoISO).toLocaleString("pt-BR");
                } else if (c.historico[0].quandoISO) {
                    dataCriacao = new Date(c.historico[0].quandoISO).toLocaleString("pt-BR");
                }
            }
            trs += `<tr style="transition: all 0.2s; border-bottom: 1px solid #edf2f7;">
                <td style="padding: 12px 20px; color: #2d3748; font-weight: 500;">${numeroCaixa}</td>
                <td style="padding: 12px 20px; color: #4a5568;">${c ? (c.unidade || '—') : '—'}</td>
                <td style="padding: 12px 20px; color: #4a5568;">${c ? formatarLocalCaixa(c) : '—'}</td>
                <td style="padding: 12px 20px; color: #718096; font-size: 13px;">${dataCriacao}</td>
            </tr>`;
        });

        let html = `
        <div class="modal-inner" style="background: #f8fafc;">
            <div class="modal-scroll-body" style="padding: 30px; overflow-x: hidden;">
                
                <!-- Cabeçalho Bonito -->
                <div style="display:flex; align-items:center; gap:16px; margin-bottom: 30px; background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); border: 1px solid #e2e8f0;">
                    <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 24px; box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.4);">
                        <i class="fas fa-file-invoice"></i>
                    </div>
                    <div>
                        <h3 style="margin:0; font-size: 22px; color: #1e293b; font-weight: 700;">Guia de Relação de Caixas</h3>
                        <p style="margin: 4px 0 0 0; font-size: 14px; color: #64748b;">Acompanhamento de caixas para digitalização</p>
                    </div>
                </div>

                <!-- Grid de Informações -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 30px;">
                    <div style="background: #fff; padding: 16px 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px;">Digitalizador</span>
                        <div style="font-size: 16px; color: #0f172a; font-weight: 600; margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-user-circle" style="color: #cbd5e1;"></i> ${rel.digitalizador}
                        </div>
                    </div>
                    <div style="background: #fff; padding: 16px 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px;">Processo</span>
                        <div style="font-size: 16px; color: #0f172a; font-weight: 600; margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-folder-open" style="color: #cbd5e1;"></i> ${rel.processo}
                        </div>
                    </div>
                    <div style="background: #fff; padding: 16px 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px;">Data de Geração</span>
                        <div style="font-size: 16px; color: #0f172a; font-weight: 600; margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-calendar-alt" style="color: #cbd5e1;"></i> ${new Date(rel.dataISO).toLocaleString()}
                        </div>
                    </div>
                    <div style="background: #fff; padding: 16px 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px;">Total de Caixas</span>
                        <div style="font-size: 16px; color: #0f172a; font-weight: 600; margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-box" style="color: #cbd5e1;"></i> ${caixasLista.length} un.
                        </div>
                    </div>
                </div>

                <!-- Tabela de Caixas -->
                <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left;">
                            <thead>
                                <tr style="background: #f1f5f9; border-bottom: 2px solid #e2e8f0;">
                                    <th style="padding: 16px 20px; color: #475569; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Caixa</th>
                                    <th style="padding: 16px 20px; color: #475569; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Unidade</th>
                                    <th style="padding: 16px 20px; color: #475569; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Localização</th>
                                    <th style="padding: 16px 20px; color: #475569; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Data de Criação</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${trs}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
            
            <!-- Ações do Modal -->
            <div class="modal-footer-actions" style="background: #fff; border-top: 1px solid #e2e8f0; padding: 20px 30px;">
                <button onclick="fecharModal()" class="btn-sec" style="padding: 12px 24px; font-weight: 600; color: #64748b; background: #f1f5f9; border: none; border-radius: 8px; transition: all 0.2s;">
                    Cancelar
                </button>
                <button onclick="window.imprimirRelacao('${id}')" class="btn-prim" style="padding: 12px 24px; font-weight: 600; background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(16,185,129,0.3); display: flex; align-items: center; gap: 8px; transition: all 0.2s;">
                    <i class="fas fa-print"></i> Imprimir Guia
                </button>
            </div>
        </div>`;

        const mb = document.querySelector("#modal .modalBox");
        if (mb) {
            mb.classList.add("modal-wide");
            mb.style.padding = "0"; // Remove padding raw para preencher totalmente com inner
        }
        
        const content = document.getElementById("modalConteudo");
        content.style.padding = "0"; // Remove padding raw para preencher totalmente
        content.innerHTML = html;
        document.getElementById("modal").style.display = "flex";
    };

    window.renderizarHistoricoRelacoes = renderizarHistoricoRelacoes;
    window.limparFiltrosRelacoes = limparFiltrosRelacoes;
    window.mudarPaginaRelacoes = mudarPaginaRelacoes;

    async function gerarRelacao(event) {
        event.preventDefault();
        const proc = document.getElementById("relProcessoSelect").value;
        const qtdDesejada = parseInt(document.getElementById("relQtdInput").value, 10);
        const dig = document.getElementById("relDigitalizadorSelect").value;
        const msg = document.getElementById("relMensagem");

        if (!proc || isNaN(qtdDesejada) || qtdDesejada <= 0 || !dig) {
            msg.style.color = "#e74c3c";
            msg.textContent = "Preencha todos os campos corretamente.";
            return;
        }

        const emRelacao = obterCaixasEmRelacao();

        // Filtra caixas preparadas do processo que ainda não estão em outra relação
        let caixasProc = db.caixas.filter(c => caixaDisponivelParaRelacao(c, proc, emRelacao));
        
        if (caixasProc.length < qtdDesejada) {
            msg.style.color = "#e74c3c";
            msg.textContent = `Não é possível gerar a relação: você solicitou ${qtdDesejada} caixa(s), mas o processo "${proc}" possui apenas ${caixasProc.length} disponível(eis) para nova relação.`;
            validarQuantidadeRelacao();
            return;
        }

        // Seleciona a quantidade solicitada
        const caixasSelecionadas = caixasProc.slice(0, qtdDesejada);

        let alteradas = 0;
        let uLogadoNome = "Administrador";
        try {
            const uStr = sessionStorage.getItem("usuarioLogado");
            const u = uStr ? JSON.parse(uStr) : null;
            uLogadoNome = (u && u.nome) ? u.nome : "Administrador";
        } catch(e) {}

        const caixasSelecionadasFull = [];
        for (let cShort of caixasSelecionadas) {
            const c = await carregarDetalhesCaixa(cShort.caixa, cShort.prateleira, cShort.status) || cShort;
            const antes = snapshotCaixaParaHistorico(c);
            
            c.usuario = dig;
            c.dataUpdate = new Date().toLocaleString();

            const mud = extrairMudancasRegistro(antes, c);
            if (mud.length > 0) {
                if (!Array.isArray(c.historico)) c.historico = [];
                c.historico.push(criarEntradaHistorico("edicao", mud, uLogadoNome));
            }
            caixasSelecionadasFull.push(c);
            alteradas++;
        }

        const novaRelacao = {
            id: Date.now().toString(),
            dataISO: new Date().toISOString(),
            processo: proc,
            digitalizador: dig,
            qtdCaixas: caixasSelecionadas.length,
            caixas: caixasSelecionadas.map(c => c.caixa)
        };
        db.relacoes.push(novaRelacao);

        await salvarDB({ config: true, caixas: caixasSelecionadasFull });
        
        msg.style.color = "#27ae60";
        msg.textContent = `Relação gerada com sucesso! ${alteradas} caixas atribuídas a ${dig}.`;
        
        renderizarHistoricoRelacoes(true);

        // Exibe o modal moderno já padronizado
        window.visualizarRelacao(novaRelacao.id);

        // Reset
        document.getElementById("relProcessoSelect").value = "";
        document.getElementById("relQtdInput").value = "";
        document.getElementById("relDigitalizadorSelect").value = "";
        atualizarTelaRelacao();
        
        clearTimeout(window._relMsgT);
        window._relMsgT = setTimeout(() => { msg.textContent = ""; }, 5000);
    }

    function logout() {
        sessionStorage.removeItem("usuarioLogado");
        window.location.href = "login.html";
    }

    // ---------------- IMPORTAÇÃO CSV ----------------
    let _importLinhasParsed = [];
    let _importEmAndamento = false;

    const IMPORT_COL_ALIASES = {
        caixa: ["caixa", "numero", "numero_caixa", "numero caixa", "n caixa", "nº caixa", "codigo", "código"],
        unidade: ["unidade"],
        inicio: ["inicio", "início", "data_inicio", "data inicio", "data início", "dt_inicio"],
        fim: ["fim", "data_fim", "data fim", "dt_fim"],
        validade: ["validade", "data_validade", "data validade", "dt_validade"],
        prateleira: ["prateleira", "prat", "endereco_prateleira"],
        nivel: ["nivel", "nível", "nivel_prateleira"],
        espaco: ["espaco", "espaço", "espaco_prateleira"],
        status: ["status", "situacao", "situação"],
        usuario: ["usuario", "usuário", "responsavel", "responsável", "responsavel_nome"],
        processos: ["processos", "processo", "tipo_processo", "tipos_processo"]
    };

    const IMPORT_STATUS_VALIDOS = ["Guardada", "Avulsa", "Preparada", "Digitalizada", "Eliminada"];

    function normalizarCabecalhoImport(h) {
        return String(h || "")
            .replace(/^\uFEFF/, "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ");
    }

    function detectarDelimitadorCSV(linha) {
        const dentroAspas = (s, idx) => {
            let q = false;
            for (let i = 0; i < idx; i++) if (s[i] === '"') q = !q;
            return q;
        };
        let sc = 0, cc = 0;
        for (let i = 0; i < linha.length; i++) {
            if (dentroAspas(linha, i)) continue;
            if (linha[i] === ";") sc++;
            else if (linha[i] === ",") cc++;
        }
        return sc >= cc ? ";" : ",";
    }

    function parseLinhaCSV(linha, delimitador) {
        const campos = [];
        let atual = "";
        let aspas = false;
        for (let i = 0; i < linha.length; i++) {
            const ch = linha[i];
            if (aspas) {
                if (ch === '"') {
                    if (linha[i + 1] === '"') { atual += '"'; i++; }
                    else aspas = false;
                } else atual += ch;
            } else if (ch === '"') aspas = true;
            else if (ch === delimitador) { campos.push(atual); atual = ""; }
            else atual += ch;
        }
        campos.push(atual);
        return campos.map(c => c.trim());
    }

    function parseCSVTexto(texto) {
        if (!texto) return { cabecalhos: [], linhas: [], delimitador: ";" };
        texto = texto.replace(/^\uFEFF/, "");
        const bruto = texto.split(/\r?\n/).filter(l => l.trim() !== "");
        if (!bruto.length) return { cabecalhos: [], linhas: [], delimitador: ";" };
        const delimitador = detectarDelimitadorCSV(bruto[0]);
        const cabecalhos = parseLinhaCSV(bruto[0], delimitador).map(normalizarCabecalhoImport);
        const linhas = [];
        for (let i = 1; i < bruto.length; i++) {
            const vals = parseLinhaCSV(bruto[i], delimitador);
            const obj = { _linhaArquivo: i + 1 };
            cabecalhos.forEach((h, j) => { obj[h] = vals[j] != null ? vals[j].trim() : ""; });
            linhas.push(obj);
        }
        return { cabecalhos, linhas, delimitador };
    }

    function mapearColunasImport(cabecalhos) {
        const map = {};
        const normAliases = {};
        Object.keys(IMPORT_COL_ALIASES).forEach(k => {
            normAliases[k] = IMPORT_COL_ALIASES[k].map(normalizarCabecalhoImport);
        });
        cabecalhos.forEach(h => {
            Object.keys(normAliases).forEach(campo => {
                if (normAliases[campo].includes(h)) map[campo] = h;
            });
        });
        return map;
    }

    function valorColunaImport(row, map, campo) {
        const chave = map[campo];
        if (!chave) return "";
        return row[chave] != null ? String(row[chave]).trim() : "";
    }

    function normalizarDataImport(val) {
        val = (val || "").trim();
        if (!val) return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
        const m = val.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
        if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
        return val;
    }

    function normalizarStatusImport(val) {
        val = (val || "").trim();
        if (!val) return "";
        const lower = val.toLowerCase();
        const found = IMPORT_STATUS_VALIDOS.find(s => s.toLowerCase() === lower);
        return found || val;
    }

    function parseProcessosImport(val) {
        if (!val || !String(val).trim()) return [];
        return String(val)
            .split(/[|;]/)
            .map(p => p.trim())
            .filter(Boolean);
    }

    function obterUsuarioImportacao() {
        try {
            const s = sessionStorage.getItem("usuarioLogado");
            if (!s || s === "admin_provisorio") return "Importação CSV";
            const u = JSON.parse(s);
            return u.nome || u.login || "Importação CSV";
        } catch (e) {
            return "Importação CSV";
        }
    }

    function chaveSlotImport(prat, nl, es) {
        return `${String(prat).trim()}|${nl}|${es}`;
    }

    function construirMapaSlotsOcupados() {
        const map = new Map();
        db.caixas.forEach(c => {
            if (caixaOcupaSlot(c))
                map.set(chaveSlotImport(c.prateleira, c.nivel, c.espaco), c.caixa);
        });
        return map;
    }

    function construirIndiceCaixasExistentes() {
        const map = new Map();
        db.caixas.forEach((c, idx) => {
            if (c && c.caixa != null)
                map.set(String(c.caixa).trim().toLowerCase(), idx);
        });
        return map;
    }

    function montarCaixaImport(row, map, registradoPor) {
        let st = normalizarStatusImport(valorColunaImport(row, map, "status"));
        let prat = valorColunaImport(row, map, "prateleira");
        let nl = parseInt(valorColunaImport(row, map, "nivel"), 10);
        let es = parseInt(valorColunaImport(row, map, "espaco"), 10);

        if (!prat && st !== "Eliminada") st = st || "Avulsa";
        else if (prat && st === "Avulsa") st = "Guardada";
        if (!st) st = prat ? "Guardada" : "Avulsa";

        if (st === "Eliminada") {
            prat = "";
            nl = 0;
            es = 0;
        } else if (!prat) {
            st = "Avulsa";
            prat = "";
            nl = 0;
            es = 0;
        } else {
            if (isNaN(nl) || isNaN(es) || nl < 1 || nl > 13 || es < 1 || es > 6)
                return { erro: "Com prateleira informada, nivel (1–13) e espaco (1–6) são obrigatórios." };
            if (!db.prateleiras.some(p => p.nome === prat))
                return { erro: `Prateleira "${prat}" não cadastrada no sistema.` };
        }

        const numCaixa = valorColunaImport(row, map, "caixa");
        if (!numCaixa) return { erro: "Número da caixa é obrigatório." };

        const item = {
            caixa: numCaixa,
            unidade: valorColunaImport(row, map, "unidade"),
            inicio: normalizarDataImport(valorColunaImport(row, map, "inicio")),
            fim: normalizarDataImport(valorColunaImport(row, map, "fim")),
            validade: normalizarDataImport(valorColunaImport(row, map, "validade")),
            prateleira: prat,
            nivel: nl,
            espaco: es,
            status: st,
            usuario: valorColunaImport(row, map, "usuario") || registradoPor,
            processos: parseProcessosImport(valorColunaImport(row, map, "processos")),
            dataUpdate: new Date().toLocaleString(),
            historico: []
        };

        if (!IMPORT_STATUS_VALIDOS.includes(item.status))
            return { erro: `Status inválido: "${item.status}". Use: ${IMPORT_STATUS_VALIDOS.join(", ")}.` };

        return { item };
    }

    function atualizarTelaImportacao() {
        const btn = document.getElementById("btnImportarCSV");
        if (btn) btn.disabled = !pastaHandle || !_importLinhasParsed.length || _importEmAndamento;
    }

    function baixarModeloImportacaoCSV() {
        const conteudo = "\uFEFFcaixa;unidade;inicio;fim;validade;prateleira;nivel;espaco;status;usuario;processos\r\n" +
            "EXEMPLO-001;01 - Sede - Campo Mourão;2021-04-28;2022-04-02;2032-05-27;0001;1;1;Guardada;João Silva;Notas Fiscais|RH / Folha\r\n" +
            "EXEMPLO-002;05 - Terminal Portuário - Paranaguá;2021-08-12;;2034-11-13;;;;Avulsa;Maria;\r\n";
        const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "modelo_importacao_caixas.csv";
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function onArquivoImportSelecionado(event) {
        const file = event.target.files && event.target.files[0];
        const resumo = document.getElementById("importResumo");
        const preview = document.getElementById("importPreview");
        const erros = document.getElementById("importErros");
        _importLinhasParsed = [];

        if (resumo) resumo.textContent = "";
        if (erros) erros.innerHTML = "";
        if (preview) preview.innerHTML = "";

        if (!file) {
            atualizarTelaImportacao();
            return;
        }

        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                const parsed = parseCSVTexto(ev.target.result);
                const map = mapearColunasImport(parsed.cabecalhos);
                if (!map.caixa) {
                    if (resumo) {
                        resumo.style.color = "#e74c3c";
                        resumo.textContent = "Coluna obrigatória não encontrada: use o cabeçalho \"caixa\" (ou \"numero\").";
                    }
                    atualizarTelaImportacao();
                    return;
                }
                _importLinhasParsed = parsed.linhas.map(row => ({ row, map, _linhaArquivo: row._linhaArquivo }));
                if (resumo) {
                    resumo.style.color = "#2c3e50";
                    resumo.textContent = `Arquivo "${file.name}": ${parsed.linhas.length} linha(s) de dados detectada(s). Delimitador: "${parsed.delimitador}".`;
                }
                renderPreviewImportacao(parsed.linhas.slice(0, 8), map);
            } catch (e) {
                console.error(e);
                if (resumo) {
                    resumo.style.color = "#e74c3c";
                    resumo.textContent = "Erro ao ler o arquivo CSV.";
                }
            }
            atualizarTelaImportacao();
        };
        reader.readAsText(file, "UTF-8");
    }

    function renderPreviewImportacao(linhas, map) {
        const preview = document.getElementById("importPreview");
        if (!preview || !linhas.length) return;
        const cols = ["caixa", "unidade", "inicio", "validade", "prateleira", "nivel", "espaco", "status", "usuario", "processos"];
        let html = "<h4 style='margin:0 0 10px;color:#2c3e50;'>Pré-visualização (primeiras linhas)</h4><table><thead><tr>";
        cols.forEach(c => { html += `<th>${c}</th>`; });
        html += "</tr></thead><tbody>";
        linhas.forEach(row => {
            html += "<tr>";
            cols.forEach(c => {
                const v = c === "processos"
                    ? parseProcessosImport(valorColunaImport(row, map, c)).join(" | ")
                    : valorColunaImport(row, map, c);
                html += `<td>${escapeHtmlUi(v || "—")}</td>`;
            });
            html += "</tr>";
        });
        html += "</tbody></table>";
        preview.innerHTML = html;
    }

    function atualizarProgressoImport(pct, texto) {
        const wrap = document.getElementById("importProgresso");
        const bar = document.getElementById("importProgressoBar");
        const txt = document.getElementById("importProgressoTexto");
        if (wrap) wrap.style.display = "block";
        if (bar) bar.style.width = Math.min(100, pct) + "%";
        if (txt) txt.textContent = texto || (Math.round(pct) + "%");
    }

    function esconderProgressoImport() {
        const wrap = document.getElementById("importProgresso");
        if (wrap) wrap.style.display = "none";
    }

    async function executarImportacaoCSV() {
        if (_importEmAndamento || !_importLinhasParsed.length) return;
        if (!pastaHandle) return alert("Selecione a pasta de dados antes de importar.");

        const modo = document.querySelector('input[name="importDuplicados"]:checked');
        const atualizarExistentes = modo && modo.value === "atualizar";
        const btn = document.getElementById("btnImportarCSV");
        const resumo = document.getElementById("importResumo");
        const errosEl = document.getElementById("importErros");

        _importEmAndamento = true;
        if (btn) btn.disabled = true;
        if (errosEl) errosEl.innerHTML = "";
        atualizarProgressoImport(0, "Carregando base…");

        try {
            const registradoPor = obterUsuarioImportacao();
            const indiceCaixas = construirIndiceCaixasExistentes();
            const slotsOcupados = construirMapaSlotsOcupados();
            const caixasNoLote = new Set();

            let importadas = 0;
            let atualizadas = 0;
            let puladas = 0;
            const caixasModificadasNoImport = [];
            const erros = [];
            const total = _importLinhasParsed.length;
            const LOTE = 80;

            for (let i = 0; i < total; i++) {
                const { row, map, _linhaArquivo } = _importLinhasParsed[i];
                const numNorm = valorColunaImport(row, map, "caixa").toLowerCase();

                if (caixasNoLote.has(numNorm)) {
                    erros.push({ linha: _linhaArquivo, caixa: valorColunaImport(row, map, "caixa"), msg: "Caixa duplicada no próprio arquivo." });
                    if ((i + 1) % LOTE === 0 || i === total - 1) {
                        atualizarProgressoImport(((i + 1) / total) * 90, `Processando ${i + 1} / ${total}…`);
                        await new Promise(r => setTimeout(r, 0));
                    }
                    continue;
                }

                const montagem = montarCaixaImport(row, map, registradoPor);
                if (montagem.erro) {
                    erros.push({ linha: _linhaArquivo, caixa: valorColunaImport(row, map, "caixa"), msg: montagem.erro });
                    continue;
                }

                const item = montagem.item;
                const chaveCaixa = String(item.caixa).trim().toLowerCase();
                const idxExistente = indiceCaixas.has(chaveCaixa) ? indiceCaixas.get(chaveCaixa) : -1;

                if (idxExistente >= 0 && !atualizarExistentes) {
                    puladas++;
                    continue;
                }

                if (caixaOcupaSlot(item)) {
                    const sk = chaveSlotImport(item.prateleira, item.nivel, item.espaco);
                    const ocupante = slotsOcupados.get(sk);
                    if (ocupante && String(ocupante).trim().toLowerCase() !== chaveCaixa) {
                        erros.push({ linha: _linhaArquivo, caixa: item.caixa, msg: `Posição ocupada pela caixa ${ocupante}.` });
                        continue;
                    }
                }

                if (idxExistente >= 0) {
                    const antesFull = await carregarDetalhesCaixa(db.caixas[idxExistente].caixa, db.caixas[idxExistente].prateleira, db.caixas[idxExistente].status);
                    const antes = antesFull ? snapshotCaixaParaHistorico(antesFull) : snapshotCaixaParaHistorico(db.caixas[idxExistente]);
                    item.historico = antesFull ? (antesFull.historico || []) : [];
                    const mud = extrairMudancasRegistro(antes, item);
                    if (mud.length > 0)
                        item.historico.push(criarEntradaHistorico("edicao", mud, registradoPor));
                    if (caixaOcupaSlot(db.caixas[idxExistente])) {
                        slotsOcupados.delete(chaveSlotImport(db.caixas[idxExistente].prateleira, db.caixas[idxExistente].nivel, db.caixas[idxExistente].espaco));
                    }
                    db.caixas[idxExistente] = item;
                    if (caixaOcupaSlot(item))
                        slotsOcupados.set(chaveSlotImport(item.prateleira, item.nivel, item.espaco), item.caixa);
                    caixasModificadasNoImport.push(item);
                    atualizadas++;
                } else {
                    item.historico = [criarEntradaHistorico("criacao", mudancasIniciaisCadastro(item), registradoPor)];
                    db.caixas.push(item);
                    indiceCaixas.set(chaveCaixa, db.caixas.length - 1);
                    if (caixaOcupaSlot(item))
                        slotsOcupados.set(chaveSlotImport(item.prateleira, item.nivel, item.espaco), item.caixa);
                    caixasModificadasNoImport.push(item);
                    importadas++;
                }

                caixasNoLote.add(numNorm);

                if ((i + 1) % LOTE === 0 || i === total - 1) {
                    atualizarProgressoImport(((i + 1) / total) * 90, `Processando ${i + 1} / ${total}…`);
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            atualizarProgressoImport(92, "Gravando banco…");
            _cacheHashCaixas = "";
            await salvarDB({ caixas: caixasModificadasNoImport });
            atualizarProgressoImport(100, "Concluído");

            if (resumo) {
                resumo.style.color = "#27ae60";
                resumo.textContent = `Importação concluída: ${importadas} nova(s), ${atualizadas} atualizada(s), ${puladas} ignorada(s) (já existiam), ${erros.length} erro(s).`;
            }

            if (erros.length && errosEl) {
                let html = "<h4 style='color:#c0392b;margin:0 0 10px;'>Linhas com erro</h4><table><thead><tr><th>Linha</th><th>Caixa</th><th>Motivo</th></tr></thead><tbody>";
                erros.slice(0, 200).forEach(e => {
                    html += `<tr><td>${e.linha}</td><td>${escapeHtmlUi(e.caixa || "—")}</td><td>${escapeHtmlUi(e.msg)}</td></tr>`;
                });
                html += "</tbody></table>";
                if (erros.length > 200) html += `<p style='font-size:13px;color:#666;'>… e mais ${erros.length - 200} erro(s).</p>`;
                errosEl.innerHTML = html;
            }

            _importLinhasParsed = [];
            const input = document.getElementById("importArquivo");
            if (input) input.value = "";
            atualizarInterface();
        } catch (e) {
            console.error(e);
            if (resumo) {
                resumo.style.color = "#e74c3c";
                resumo.textContent = "Falha na importação. Verifique o console ou tente novamente.";
            }
        } finally {
            _importEmAndamento = false;
            if (btn) btn.disabled = true;
            setTimeout(esconderProgressoImport, 2500);
        }
    }