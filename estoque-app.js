let db = { caixas: [], prateleiras: [], processos: [], unidades: [] };
    let edit=null, pastaHandle, lastHash = "";
    
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
    // ------------------------------------------

    let _dashChart1 = null, _dashChart2 = null;
    let dashProcessoInicializado = false;
    const ERP_PAGE_ID = window.ERP_PAGE_ID || "index";

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
        
        await inicializarPasta();

        verificarAutenticacao();

        if(ERP_PAGE_ID === "dashboard") atualizarDashboard();
        if(ERP_PAGE_ID === "mapa") mapa();
        if(ERP_PAGE_ID === "avulsas") renderAvulsas();
        if(ERP_PAGE_ID === "preparacao") atualizarTelaPreparacao();
        if(ERP_PAGE_ID === "digitalizacao") atualizarTelaDigitalizacao();
        if(ERP_PAGE_ID === "relacao") atualizarTelaRelacao();

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

    async function carregarDB(silencioso = false){
        if(!pastaHandle) return;
        try{
            const arquivo = await pastaHandle.getFileHandle("banco_erp.json",{create:true});
            const file = await arquivo.getFile();
            const texto = await file.text();

            if (texto !== lastHash) {
                lastHash = texto;
                db = texto ? JSON.parse(texto) : { caixas: [], prateleiras: [], processos: [], unidades: [], responsaveis: [], relacoes: [] };
                if(!db.processos) db.processos = [];
                if(!db.unidades) db.unidades = [];
                if(!db.responsaveis) db.responsaveis = [];
                if(!db.relacoes) db.relacoes = [];
                
                // Normaliza funções antigas para as novas "Preparador" e "Digitalizador"
                db.responsaveis.forEach(r => {
                    if (r.funcao === "Preparada") r.funcao = "Preparador";
                    else if (r.funcao === "Digitalizada") r.funcao = "Digitalizador";
                    else if (["Guardada", "Avulsa", "Eliminada"].includes(r.funcao)) r.funcao = ""; // Remove funções não mapeadas
                });
                
                garantirHistoricoCaixas();
                normalizarEliminadasELocaisAvulsos();
                atualizarInterface();
                const slSync = document.getElementById("syncLabel");
                if(slSync) slSync.innerText = "Sinc.: " + new Date().toLocaleTimeString();
                if(ERP_PAGE_ID === "lancamento") aplicarEdicaoSeNecessario();
            }
        }catch(err){ console.error(err); }
    }

    async function salvarDB(){
        const arquivo = await pastaHandle.getFileHandle("banco_erp.json",{create:true});
        const writable = await arquivo.createWritable();
        const conteudo = JSON.stringify(db, null, 2);
        await writable.write(conteudo);
        await writable.close();
        lastHash = conteudo;
    }

    // ---------------- GESTÃO DE PRATELEIRAS ----------------
    async function adicionarPrateleira(){
        const nome = document.getElementById("nomePrateleiraNova").value.trim();
        if(!nome) return;
        if(db.prateleiras.find(p => p.nome === nome)) return alert("Prateleira já existe!");
        db.prateleiras.push({ nome: nome, capacidade: 78 });
        await salvarDB();
        document.getElementById("nomePrateleiraNova").value = "";
        atualizarInterface();
    }

    async function excluirPrateleira(nome){
        if(db.caixas.some(c => caixaOcupaSlot(c) && c.prateleira === nome)) return alert("Não é possível excluir: há caixas alocadas nesta prateleira!");
        if(confirm(`Excluir prateleira ${nome}?`)){
            db.prateleiras = db.prateleiras.filter(p => p.nome !== nome);
            await salvarDB();
            atualizarInterface();
        }
    }

    // ---------------- GESTÃO DE PROCESSOS ----------------
    async function adicionarProcesso(){
        const nome = document.getElementById("nomeProcessoNovo").value.trim();
        if(!nome) return;
        if(db.processos.includes(nome)) return alert("Processo já existe!");
        db.processos.push(nome);
        await salvarDB();
        document.getElementById("nomeProcessoNovo").value = "";
        atualizarInterface();
    }

    async function excluirProcesso(nome){
        if(db.caixas.some(c => c.processos && c.processos.includes(nome)))
            return alert("Não é possível excluir: existem caixas vinculadas a este processo!");
        if(confirm(`Excluir processo ${nome}?`)){
            db.processos = db.processos.filter(p => p !== nome);
            await salvarDB();
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
        await salvarDB();
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
            await salvarDB();
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

        await salvarDB();
        
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

        const html = `
        <div id="responsavelEditTela" style="max-height: 80vh; overflow-y: auto; overflow-x: hidden; text-align: left; padding: 20px; width: 600px; max-width: 95vw; box-sizing: border-box;">
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

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; border-top: 1px solid #eee; padding-top: 15px;">
                    <button type="button" class="btn-sec" onclick="fecharModal()">Cancelar</button>
                    <button type="button" class="btn-prim" onclick="salvarEdicaoResponsavelModal()">Salvar Alterações</button>
                </div>
            </div>
        </div>
        `;
        
        document.getElementById("modalConteudo").innerHTML = html;
        document.getElementById("modalConteudo").classList.add("modal-wide");
        document.getElementById("modal").style.display = "flex";
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
        
        await salvarDB();
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
            await salvarDB();
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
        if(!db || !Array.isArray(db.caixas)) return;
        db.caixas.forEach(c => { if(!Array.isArray(c.historico)) c.historico = []; });
    }

    function normalizarEliminadasELocaisAvulsos(){
        if(!db || !Array.isArray(db.caixas)) return;
        db.caixas.forEach(c => {
            if(c.status === "Eliminada"){
                c.prateleira = "";
                c.nivel = 0;
                c.espaco = 0;
            } else if(!c.prateleira || !String(c.prateleira).trim() || c.status === "Avulsa"){
                c.status = "Avulsa";
                c.prateleira = "";
                c.nivel = 0; c.espaco = 0;
            }
        });
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
        await carregarDB(true);

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
        if(edit !== null && db.caixas[edit]){
            const h0 = db.caixas[edit].historico;
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

        if(edit !== null){
            const antes = snapshotCaixaParaHistorico(db.caixas[edit]);
            const mud = extrairMudancasRegistro(antes, item);
            if(mud.length > 0)
                item.historico.push(criarEntradaHistorico("edicao", mud, item.usuario));
        } else {
            item.historico = [criarEntradaHistorico("criacao", mudancasIniciaisCadastro(item), item.usuario)];
        }

        if(edit !== null) db.caixas[edit] = item;
        else db.caixas.push(item);

        await salvarDB();
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
        <div id="lancamentoTela" style="max-height: 80vh; overflow-y: auto; text-align: left; padding: 10px;">
            <h2 style="margin-top:0;">📝 Editar Caixa: ${escModal(c.caixa)}</h2>
            <form id="cadastroForm" onsubmit="salvar(event)">
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

                    <div class="lancamento-acoes" style="justify-content: flex-end; gap: 10px; margin-top: 20px;">
                        <button type="button" class="btn-sec" id="btnCancelar" onclick="fecharModal()">Cancelar</button>
                        <button type="submit" class="btn-prim" id="btnSalvar">Salvar Alterações</button>
                    </div>
                </div>
            </form>
        </div>
        `;

        const mb = document.querySelector("#modal .modalBox");
        if(mb) mb.classList.add("modal-wide");
        
        document.getElementById("modalConteudo").innerHTML = html;
        document.getElementById("modal").style.display = "flex";

        renderSelectPrateleiras();
        renderSelectUnidades();
        renderCheckboxesProcessos();
        atualizarOpcoesResponsavel();

        preencherFormularioEdicao(i);
    }

    function preencherFormularioEdicao(i){
        if(typeof esconderMsgLancamentoOk === "function") esconderMsgLancamentoOk();
        const c = db.caixas[i];
        if(!c) return;
        
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
        
        setVal("caixa", c.caixa);
        setVal("unidadeSelect", c.unidade || "");
        setVal("inicio", c.inicio);
        setVal("fim", c.fim);
        setVal("validade", c.validade);
        setVal("prateleiraSelect", c.prateleira || "");
        setVal("nivel", (c.nivel && parseInt(c.nivel, 10) >= 1) ? c.nivel : "");
        setVal("espaco", (c.espaco && parseInt(c.espaco, 10) >= 1) ? c.espaco : "");
        setVal("status", c.status);
        setVal("usuarioStatus", c.usuario);

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
            db.caixas.splice(i, 1);
            await salvarDB();
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

    function detalhes(i){
        const c = db.caixas[i];
        const procs = c.processos ? c.processos.join(", ") : "Nenhum";
        const mb = document.querySelector("#modal .modalBox");
        if(mb) mb.classList.add("modal-wide");
        document.getElementById("modalConteudo").innerHTML = `
            <h3>Caixa: ${escModal(c.caixa)}</h3>
            <p><b>Unidade:</b> ${escModal(c.unidade || "—")}</p>
            <p><b>Processos:</b> ${escModal(procs)}</p>
            <p><b>Local:</b> ${escModal(formatarLocalCaixa(c))}</p>
            <p><b>Status:</b> ${escModal(c.status)}</p>
            <p><b>Validade:</b> ${escModal(c.validade)}</p>
            <p><b>Responsável:</b> ${escModal(c.usuario)}</p>
            <p><small>Última atualização: ${escModal(c.dataUpdate || "N/A")}</small></p>
            <h4 style="margin:16px 0 6px 0;font-size:14px;color:#2c3e50;">Histórico</h4>
            <div class="historico-caixa">${renderHtmlHistorico(c)}</div>
            <hr>
            <button onclick="fecharModal()">Fechar</button>
        `;
        document.getElementById("modal").style.display = "flex";
    }
    function fecharModal(){
        document.getElementById("modal").style.display = "none";
        const mb = document.querySelector("#modal .modalBox");
        if(mb) mb.classList.remove("modal-wide");
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
            if (c.documentos) totalDocs += parseInt(c.documentos, 10);
        });

        const numDigitalizadores = (db.responsaveis || []).filter(r => r.funcao === "Digitalizador" || r.funcao === "Administrador").length;
        const mediaPorDig = numDigitalizadores > 0 ? Math.round(totalDocs / numDigitalizadores) : 0;

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
                <div class="kpi-lbl">Total de Docs.</div>
                <div class="kpi-val" id="kpiMediaDocs">0</div>
                <div class="kpi-sub">Soma de documentos registrados nas caixas</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-lbl">Média de Docs por Dig.</div>
                <div class="kpi-val" id="kpiMediaPorDig">0</div>
                <div class="kpi-sub">Ref: ${numDigitalizadores} digitalizador(es) ativo(s)</div>
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
            animarNumeros("kpiMediaDocs", totalDocs, 1000);
            animarNumeros("kpiMediaPorDig", mediaPorDig, 1000);
        }, 100);    }

    function renderProducaoDiaria(filtradas) {
        const el = document.getElementById("tabelaProducaoDiaria");
        if(!el) return;

        const producao = {}; 
        const datasSet = new Set();

        filtradas.forEach(c => {
            let teveHistorico = false;
            if(c.historico && Array.isArray(c.historico)) {
                c.historico.forEach(h => {
                    const mud = h.mudancas || [];
                    const virouDig = mud.some(m => m.campo === "status" && m.para === "Digitalizada");
                    if(virouDig) {
                        teveHistorico = true;
                        const dataObj = h.quandoISO ? new Date(h.quandoISO) : null;
                        if(dataObj) {
                            const d = String(dataObj.getDate()).padStart(2, '0');
                            const m = String(dataObj.getMonth() + 1).padStart(2, '0');
                            const y = dataObj.getFullYear();
                            const dataStr = `${d}/${m}/${y}`;
                            
                            const usuario = h.registradoPor || c.usuario || "Desconhecido";
                            
                            if(!producao[usuario]) producao[usuario] = { total: 0 };
                            if(!producao[usuario][dataStr]) producao[usuario][dataStr] = 0;
                            
                            const docMud = mud.find(m => m.campo === "documentos");
                            let qtd = 0;
                            if (docMud && !isNaN(parseInt(docMud.para, 10))) {
                                qtd = parseInt(docMud.para, 10);
                            } else if (c.documentos) {
                                qtd = c.documentos;
                            }
                            
                            producao[usuario][dataStr] += qtd;
                            producao[usuario].total += qtd;
                            datasSet.add(dataStr);
                        }
                    }
                });
            } 
            
            if (!teveHistorico && c.status === "Digitalizada") {
                let altDate = null;
                if(c.dataUpdate) {
                    const matchBr = String(c.dataUpdate).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
                    if(matchBr) {
                        altDate = `${matchBr[1].padStart(2, '0')}/${matchBr[2].padStart(2, '0')}/${matchBr[3]}`;
                    } else if(String(c.dataUpdate).match(/^\d{4}-\d{2}-\d{2}/)) {
                        const p = String(c.dataUpdate).substring(0, 10).split("-");
                        altDate = `${p[2]}/${p[1]}/${p[0]}`;
                    }
                }
                if(!altDate) altDate = "Sem Data";
                
                const usuario = c.usuario || "Desconhecido";
                if(!producao[usuario]) producao[usuario] = { total: 0 };
                if(!producao[usuario][altDate]) producao[usuario][altDate] = 0;
                
                const qtd = c.documentos || 0;
                producao[usuario][altDate] += qtd;
                producao[usuario].total += qtd;
                datasSet.add(altDate);
            }
        });

        if(Object.keys(producao).length === 0) {
            el.innerHTML = "<p style='color: #7f8c8d; font-size: 14px;'>Nenhuma produção de digitalização encontrada no período/filtro atual.</p>";
            return;
        }

        const datasArr = Array.from(datasSet).sort((a,b) => {
            if(a === "Sem Data") return 1;
            if(b === "Sem Data") return -1;
            const pa = a.split('/');
            const pb = b.split('/');
            const da = new Date(pa[2], pa[1]-1, pa[0]);
            const db = new Date(pb[2], pb[1]-1, pb[0]);
            return da - db;
        });

        let html = `<table class="tabela-padrao" style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="text-align: left; border-bottom: 2px solid #ccc; padding: 8px;">Digitalizador</th>`;
        
        datasArr.forEach(d => {
            html += `<th style="text-align: center; border-bottom: 2px solid #ccc; padding: 8px;">${d}</th>`;
        });
        
        html += `<th style="text-align: center; border-bottom: 2px solid #ccc; padding: 8px;">Total</th>
                 <th style="text-align: center; border-bottom: 2px solid #ccc; padding: 8px;">Média Diária</th>
                </tr>
            </thead>
            <tbody>`;

        for(const user in producao) {
            html += `<tr><td style="border-bottom: 1px solid #eee; padding: 8px;"><b>${escModal(user)}</b></td>`;
            
            let diasTrabalhados = 0;
            datasArr.forEach(d => {
                const val = producao[user][d] || 0;
                if(val > 0) diasTrabalhados++;
                html += `<td style="text-align: center; border-bottom: 1px solid #eee; padding: 8px;">${val > 0 ? val : '-'}</td>`;
            });
            
            const media = diasTrabalhados > 0 ? (producao[user].total / diasTrabalhados).toFixed(1) : 0;
            
            html += `<td style="text-align: center; font-weight: bold; border-bottom: 1px solid #eee; padding: 8px;">${producao[user].total}</td>
                     <td style="text-align: center; font-weight: bold; color: #2980b9; border-bottom: 1px solid #eee; padding: 8px;">${media}</td>
                   </tr>`;
        }

        html += `</tbody></table>`;
        el.innerHTML = html;
    }

    function renderDashboardDados(){
        preencherSelectsDashboard();
        const filtradas = caixasFiltradasDashboard();
        renderKpis(filtradas);
        renderProducaoDiaria(filtradas);
        destruirDashboardCharts();
        montarChart("chartDashboard1", "dashDim1", "dashTipo1", filtradas);
        montarChart("chartDashboard2", "dashDim2", "dashTipo2", filtradas);
    }

    function atualizarDashboard(){
        if(!document.getElementById("dashBusca")) return;
        renderDashboardDados();
    }

    (function initDashboardUI(){
        const reagir = ["dashDim1","dashTipo1","dashDim2","dashTipo2"];
        reagir.forEach(id => {
            const n = document.getElementById(id);
            if(n) n.addEventListener("change", () => {
                if(document.getElementById("dashBusca")) renderDashboardDados();
            });
        });
        const busca = document.getElementById("dashBusca");
        if(busca) {
            busca.addEventListener("input", () => {
                renderDashboardDados();
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
        const avulsas = db.caixas.filter(c => c.status === "Avulsa" && (!c.prateleira || !c.prateleira.trim()) && c.status !== "Eliminada");

        if (avulsas.length === 0) return alert("Não há caixas avulsas para alocar.");
        if (db.prateleiras.length === 0) return alert("Cadastre ao menos uma prateleira primeiro.");

        let alocadasCont = 0;
        let logs = [];

        for (let c of avulsas) {
            let alocada = false;
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
                            c.historico.push(criarEntradaHistorico("edicao", mudanca, "Sistema (Auto)"));
                            
                            logs.push(`Caixa ${c.caixa} -> ${p.nome} (N${n}-S${e})`);
                            alocada = true;
                            alocadasCont++;
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
            await salvarDB();
            atualizarInterface();
            alert(`Sucesso! ${alocadasCont} caixa(s) foram alocadas automaticamente.`);
        } else {
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
                const foiAlocada = c.historico && c.historico.some(h => 
                    h.mudancas && h.mudancas.some(m => m.campo === "localizacao" && (m.de === "Avulsa" || m.de === "Avulsa (sem prateleira)"))
                );
                return temLocal && foiAlocada && c.status !== "Eliminada";
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

        html += `</tbody></table><br><button onclick="window.print()">Imprimir Relatório</button> <button onclick="fecharModal()">Fechar</button>`;
        
        const mb = document.querySelector("#modal .modalBox");
        if(mb) mb.classList.add("modal-wide");
        document.getElementById("modalConteudo").innerHTML = html;
        document.getElementById("modal").style.display = "flex";
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
            await carregarDB(true);

            let alteradas = 0;
            let naoEncontradas = [];

            for (const numCaixa of caixasSelecionadasParaPreparo) {
                const idx = db.caixas.findIndex(c => c.caixa.toLowerCase() === numCaixa.toLowerCase());
                
                if (idx === -1) {
                    naoEncontradas.push(numCaixa);
                    continue;
                }

                const caixa = db.caixas[idx];
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
                alteradas++;
            }

            if (alteradas > 0) {
                await salvarDB();
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
                    await carregarDB(true);
                    
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
                    await salvarDB();
                    
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
            await carregarDB(true);

            let alteradas = 0;
            let naoEncontradas = [];

            const qtdDocsInput = document.getElementById("digQtdDocs");
            let docsPorCaixa = 0;
            if (qtdDocsInput && qtdDocsInput.value) {
                const totalDocs = parseInt(qtdDocsInput.value, 10);
                docsPorCaixa = Math.round(totalDocs / caixasSelecionadasParaDigitalizar.length);
            }

            for (const numCaixa of caixasSelecionadasParaDigitalizar) {
                const idx = db.caixas.findIndex(c => c.caixa.toLowerCase() === numCaixa.toLowerCase());

                if (idx === -1) {
                    naoEncontradas.push(numCaixa);
                    continue;
                }

                const caixa = db.caixas[idx];
                const antes = snapshotCaixaParaHistorico(caixa);

                caixa.status = "Digitalizada";
                caixa.usuario = funcionario;
                caixa.dataUpdate = new Date().toLocaleString();
                if (docsPorCaixa > 0) {
                    caixa.documentos = (caixa.documentos || 0) + docsPorCaixa;
                }

                const mud = extrairMudancasRegistro(antes, caixa);
                if (docsPorCaixa > 0) {
                    mud.push({ campo: "documentos", label: "Qtd. Documentos", de: "0", para: String(docsPorCaixa) });
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
                alteradas++;
            }

            if (alteradas > 0) {
                await salvarDB();
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

        // Preencher Processos que possuem caixas preparadas
        const processosComPreparadas = new Set();
        db.caixas.forEach(c => {
            if (c.status === "Preparada" && Array.isArray(c.processos)) {
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
            renderizarHistoricoRelacoes();
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
            return;
        }

        const qtdPreparadas = db.caixas.filter(c => c.status === "Preparada" && Array.isArray(c.processos) && c.processos.includes(proc)).length;

        qtdInfo.textContent = `Caixas preparadas disponíveis neste processo: ${qtdPreparadas}`;
        
        if (qtdPreparadas > 0) {
            inputQtd.disabled = false;
            inputQtd.max = qtdPreparadas;
            btnGerar.disabled = false;
        } else {
            inputQtd.disabled = true;
            inputQtd.value = "";
            btnGerar.disabled = true;
        }
    }

    function renderizarHistoricoRelacoes() {
        const tbody = document.getElementById("tbodyHistoricoRelacoes");
        const msgVazio = document.getElementById("historicoRelacoesMsg");
        
        if (!tbody || !msgVazio) return;

        const filtroDig = document.getElementById("filtroDigitalizadorRel").value;
        const filtroDataIni = document.getElementById("filtroDataInicialRel").value;
        const filtroDataFim = document.getElementById("filtroDataFinalRel").value;

        tbody.innerHTML = "";
        
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

        relacoesFiltradas.forEach(rel => {
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
    }

    function limparFiltrosRelacoes() {
        document.getElementById("filtroDigitalizadorRel").value = "";
        document.getElementById("filtroDataInicialRel").value = "";
        document.getElementById("filtroDataFinalRel").value = "";
        renderizarHistoricoRelacoes();
    }

    window.visualizarRelacao = function(id) {
        const rel = db.relacoes.find(r => r.id === id);
        if (!rel) return;

        let html = `<h3>Relação de Caixas para Digitalização</h3>
            <p><strong>Digitalizador Destino:</strong> ${rel.digitalizador}</p>
            <p><strong>Processo:</strong> ${rel.processo}</p>
            <p><strong>Data:</strong> ${new Date(rel.dataISO).toLocaleDateString()} ${new Date(rel.dataISO).toLocaleTimeString()}</p>
            <table class="tabela" style="width: 100%; text-align: left; border-collapse: collapse;">
                <thead><tr style="background-color: #ecf0f1;"><th style="padding: 8px;">Caixa</th><th style="padding: 8px;">Unidade</th><th style="padding: 8px;">Localização</th></tr></thead>
                <tbody>`;
        
        rel.caixas.forEach(numeroCaixa => {
            const c = db.caixas.find(cx => cx.caixa === numeroCaixa);
            const unidade = c ? c.unidade : '—';
            const local = c ? formatarLocalCaixa(c) : '—';

            html += `<tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${numeroCaixa}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${unidade}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${local}</td>
            </tr>`;
        });
        
        html += `</tbody></table><br>
        <div style="margin-top:20px; text-align: right;">
            <button onclick="window.print()" style="padding:10px 15px; background:#3498db; color:#fff; border:none; border-radius:4px; cursor:pointer; margin-right: 10px;">Imprimir Relação</button> 
            <button onclick="fecharModal()" style="padding:10px 15px; background:#7f8c8d; color:#fff; border:none; border-radius:4px; cursor:pointer;">Fechar</button>
        </div>`;
        
        const mb = document.querySelector("#modal .modalBox");
        if(mb) {
            mb.innerHTML = html;
            abrirModal();
        }
    };

    window.renderizarHistoricoRelacoes = renderizarHistoricoRelacoes;
    window.limparFiltrosRelacoes = limparFiltrosRelacoes;

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

        // Filtra caixas preparadas do processo
        let caixasProc = db.caixas.filter(c => c.status === "Preparada" && Array.isArray(c.processos) && c.processos.includes(proc));
        
        if (caixasProc.length < qtdDesejada) {
            msg.style.color = "#e74c3c";
            msg.textContent = `Apenas ${caixasProc.length} caixas estão preparadas.`;
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

        for (let c of caixasSelecionadas) {
            const antes = snapshotCaixaParaHistorico(c);
            
            c.usuario = dig;
            c.dataUpdate = new Date().toLocaleString();

            const mud = extrairMudancasRegistro(antes, c);
            if (mud.length > 0) {
                if (!Array.isArray(c.historico)) c.historico = [];
                c.historico.push(criarEntradaHistorico("edicao", mud, uLogadoNome));
            }
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

        await salvarDB();
        
        msg.style.color = "#27ae60";
        msg.textContent = `Relação gerada com sucesso! ${alteradas} caixas atribuídas a ${dig}.`;
        
        renderizarHistoricoRelacoes();

        // Gerar relatório para impressão
        let html = `<h3>Relação de Caixas para Digitalização</h3>
            <p><strong>Digitalizador Destino:</strong> ${dig}</p>
            <p><strong>Processo:</strong> ${proc}</p>
            <p><strong>Data:</strong> ${new Date().toLocaleDateString()}</p>
            <table class="tabela">
                <thead><tr><th>Caixa</th><th>Unidade</th><th>Localização</th><th>Data de Criação</th></tr></thead>
                <tbody>`;
        
        caixasSelecionadas.forEach(c => {
            let dataCriacao = "—";
            if (Array.isArray(c.historico) && c.historico.length > 0) {
                const criacaoHist = c.historico.find(h => h.tipo === "criacao" || h.acao === "criacao");
                if (criacaoHist && criacaoHist.quandoISO) {
                    dataCriacao = new Date(criacaoHist.quandoISO).toLocaleString("pt-BR");
                } else if (c.historico[0].quandoISO) {
                    dataCriacao = new Date(c.historico[0].quandoISO).toLocaleString("pt-BR");
                }
            }
            
            html += `<tr>
                <td>${c.caixa}</td>
                <td>${c.unidade || '—'}</td>
                <td>${formatarLocalCaixa(c)}</td>
                <td>${dataCriacao}</td>
            </tr>`;
        });
        
        html += `</tbody></table><br>
        <div style="margin-top:20px;">
            <button onclick="window.print()" style="padding:10px 15px; background:#3498db; color:#fff; border:none; border-radius:4px; cursor:pointer;">Imprimir Relação</button> 
            <button onclick="fecharModal()" style="padding:10px 15px; background:#7f8c8d; color:#fff; border:none; border-radius:4px; cursor:pointer;">Fechar</button>
        </div>`;
        const mb = document.querySelector("#modal .modalBox");
        if(mb) mb.classList.add("modal-wide");
        document.getElementById("modalConteudo").innerHTML = html;
        document.getElementById("modal").style.display = "flex";

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