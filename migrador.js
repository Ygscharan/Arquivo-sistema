const fs = require('fs').promises;
const path = require('path');

// 2. Criar apenas arquivos que ainda não existem
async function existe(arquivo) {
    try {
        await fs.access(arquivo);
        return true;
    } catch {
        return false;
    }
}

// 11. Criar log (registrando início, etapas, erros, conclusão e imprimindo no console)
async function registrarLog(mensagem, tipo = 'info', sobrescreverConsole = false) {
    const data = new Date().toISOString();
    let linhaLog = `[${data}] ${mensagem}\n`;
    
    // Controle de exibição no console
    if (tipo === 'erro') {
        console.error(mensagem);
        linhaLog = `[${data}] ERRO: ${mensagem}\n`;
    } else if (sobrescreverConsole) {
        process.stdout.write(`\r${mensagem}`);
    } else {
        console.log(mensagem);
    }

    // Gravação no arquivo de log
    try {
        // Remove \r caso seja uma linha de progresso, para não sujar o log
        await fs.appendFile('migracao.log', linhaLog.replace(/\r/g, ''));
    } catch (e) {
        console.error('Falha crítica: Não foi possível escrever no migracao.log', e);
    }
}

// 15. Barra de progresso percentual
function barraProgresso(atual, total) {
    const percentual = Math.floor((atual / total) * 100);
    const tamanho = 20;
    const preenchido = Math.floor((tamanho * percentual) / 100);
    const vazio = tamanho - preenchido;
    return `██████████`.slice(0, preenchido) + `░░░░░░░░░░`.slice(0, vazio) + ` ${percentual}%`;
}

// 14. Tratamento de erros (try/catch em todas operações de escrita)
async function salvarArquivo(caminho, dados) {
    try {
        await fs.writeFile(caminho, JSON.stringify(dados, null, 2), 'utf-8');
        return true;
    } catch (erro) {
        await registrarLog(`Falha ao salvar o arquivo ${caminho}: ${erro.message}`, 'erro');
        return false;
    }
}

async function iniciarMigracao() {
    await registrarLog('\n--- início ---');

    const bancoPath = 'banco_erp.json';
    const backupPath = 'banco_erp_backup.json';
    const configPath = 'config_erp.json';
    const indexPath = 'caixas_index.json';
    const avulsasPath = 'caixas_avulsas.json';
    const eliminadasPath = 'caixas_eliminadas.json';
    const pastaPrateleiras = 'caixas_prateleiras';

    // 10. Mostrar etapas
    await registrarLog('Lendo banco...');
    
    if (!(await existe(bancoPath))) {
        await registrarLog(`O arquivo ${bancoPath} não foi encontrado. A migração pode já ter sido finalizada.`);
        return;
    }

    let bancoOriginal;
    try {
        const conteudo = await fs.readFile(bancoPath, 'utf-8');
        bancoOriginal = JSON.parse(conteudo);
        await registrarLog('Banco carregado.');
    } catch (erro) {
        await registrarLog(`Falha ao ler ou parsear o banco original: ${erro.message}`, 'erro');
        return;
    }

    // ============================================================================
    // 16. Não modificar a lógica, nomes, regras ou estrutura.
    // INSIRA AQUI A SUA LÓGICA DE PREPARAÇÃO DOS DADOS DO BANCO ORIGINAL.
    // Exemplo de variáveis esperadas para o restante do código:
    // ============================================================================
    
    // Extraia do `bancoOriginal` exatamente como faz hoje:
    const dadosConfig = bancoOriginal.config || {}; 
    const dadosIndex = bancoOriginal.index || [];
    const dadosAvulsas = bancoOriginal.avulsas || [];
    const dadosEliminadas = bancoOriginal.eliminadas || [];
    
    // Objeto agrupando as prateleiras: { "A01": [...], "B02": [...] }
    const prateleiras = bancoOriginal.prateleiras || {}; 
    const nomesPrateleiras = Object.keys(prateleiras);

    // ============================================================================

    // 3. Não recriar o backup
    await registrarLog('Criando backup...');
    if (!(await existe(backupPath))) {
        const sucesso = await salvarArquivo(backupPath, bancoOriginal);
        if (sucesso) await registrarLog('Backup criado.');
    } else {
        await registrarLog('Backup já existe.'); // 13. Reutilizar backup existente
    }

    // 1 e 4. Nunca interromper a migração por causa do config e não recriá-lo
    await registrarLog('Criando config...');
    if (!(await existe(configPath))) {
        const sucesso = await salvarArquivo(configPath, dadosConfig);
        if (sucesso) await registrarLog('Config criado.');
    } else {
        await registrarLog('Config já existe.'); // 13. Reutilizar config existente
    }

    // 5. Não recriar caixas_index.json
    await registrarLog('Criando índice...');
    if (!(await existe(indexPath))) {
        const sucesso = await salvarArquivo(indexPath, dadosIndex);
        if (sucesso) await registrarLog('Índice criado.');
    } else {
        await registrarLog('Índice já existe.'); // 13. Reutilizar índice existente
    }

    // 8. Prateleiras
    await registrarLog('Criando prateleiras...');
    if (!(await existe(pastaPrateleiras))) {
        try {
            await fs.mkdir(pastaPrateleiras, { recursive: true });
        } catch (erro) {
            await registrarLog(`Erro ao criar diretório de prateleiras: ${erro.message}`, 'erro');
        }
    }

    const totalPrateleiras = nomesPrateleiras.length;
    let contadorPrateleiras = 0;

    for (let i = 0; i < totalPrateleiras; i++) {
        const nomePrat = nomesPrateleiras[i];
        const pratPath = path.join(pastaPrateleiras, `prateleira_${nomePrat}.json`);

        // Verifica individualmente
        if (!(await existe(pratPath))) {
            await registrarLog(`[${i + 1}/${totalPrateleiras}] Criando prateleira ${nomePrat}...`);
            await salvarArquivo(pratPath, prateleiras[nomePrat]);
        }
        
        contadorPrateleiras++;
        
        // 9 e 15. Mostrar progresso / Barra de progresso
        await registrarLog(`Processando prateleiras... ${barraProgresso(contadorPrateleiras, totalPrateleiras)}`, 'info', true);
    }
    console.log(); // Quebra de linha após finalizar a barra de progresso

    // 6. Não recriar caixas_avulsas.json
    await registrarLog('Criando caixas avulsas...');
    if (!(await existe(avulsasPath))) {
        await salvarArquivo(avulsasPath, dadosAvulsas);
    } else {
        await registrarLog('Caixas avulsas já existem.');
    }

    // 7. Não recriar caixas_eliminadas.json
    await registrarLog('Criando eliminadas...');
    if (!(await existe(eliminadasPath))) {
        await salvarArquivo(eliminadasPath, dadosEliminadas);
    } else {
        await registrarLog('Caixas eliminadas já existem.');
    }

    // 12. Nunca apagar banco_erp.json enquanto existir qualquer arquivo pendente
    await registrarLog('Validando integridade da migração...');
    let todosArquivosCriados = true;
    const arquivosCriticos = [backupPath, configPath, indexPath, avulsasPath, eliminadasPath];

    for (const arquivo of arquivosCriticos) {
        if (!(await existe(arquivo))) {
            await registrarLog(`Arquivo obrigatório ausente: ${arquivo}. O banco original não será apagado.`, 'erro');
            todosArquivosCriados = false;
        }
    }

    for (const nomePrat of nomesPrateleiras) {
        const pratPath = path.join(pastaPrateleiras, `prateleira_${nomePrat}.json`);
        if (!(await existe(pratPath))) {
            await registrarLog(`Prateleira pendente: ${pratPath}. O banco original não será apagado.`, 'erro');
            todosArquivosCriados = false;
        }
    }

    if (todosArquivosCriados) {
        try {
            await fs.unlink(bancoPath);
            await registrarLog(`Banco original (${bancoPath}) deletado com sucesso.`);
        } catch (erro) {
            await registrarLog(`Falha ao apagar ${bancoPath}: ${erro.message}`, 'erro');
        }
    }

    await registrarLog('conclusão');
    await registrarLog('Finalizado.');
}

iniciarMigracao();