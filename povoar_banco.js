/**
 * SCRIPT DE POVOAMENTO DO BANCO DE DADOS
 * =======================================
 * Popula as caixas com status "Guardada" com histórico realista de:
 *   1. PREPARAÇÃO  → feita pelos Preparadores (2-5 caixas/dia, seg-sex)
 *   2. DIGITALIZAÇÃO → feita pelos Digitalizadores (1-4 caixas/dia, seg-sex)
 *      - com documentos entre 500 e 3000 por caixa (geralmente 1000-2200)
 *
 * Período: 1 ano retroativo a partir de hoje
 *
 * COMO USAR:
 *   node povoar_banco.js
 */

const fs   = require('fs');
const path = require('path');

// ── Configurações ──────────────────────────────────────────────────────────
const BASE_DIR      = __dirname;
const INDEX_FILE    = path.join(BASE_DIR, 'caixas_index.json');
const CONFIG_FILE   = path.join(BASE_DIR, 'config_erp.json');
const PRATELEIRAS   = path.join(BASE_DIR, 'caixas_prateleiras');

const PREP_MIN  = 2, PREP_MAX  = 5, PREP_RARO  = 8;
const DIG_MIN   = 1, DIG_MAX   = 4, DIG_RARO   = 6;
const DOC_MIN   = 500,  DOC_MAX  = 3000;
const DOC_COMUM_MIN = 1000, DOC_COMUM_MAX = 2200;

// ── Utilitários ────────────────────────────────────────────────────────────
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function gerarDocs() {
  const r = Math.random();
  if (r < 0.05)  return rand(DOC_MIN, 999);
  if (r < 0.75)  return rand(DOC_COMUM_MIN, DOC_COMUM_MAX);
  if (r < 0.97)  return rand(2201, 2800);
  return rand(2801, DOC_MAX);
}

function gerarCaixasDia(min, max, raro, chanceRaro = 0.05) {
  if (Math.random() < chanceRaro) return rand(max + 1, raro);
  return rand(min, max);
}

function isDiaUtil(date) {
  const dow = date.getDay();
  return dow >= 1 && dow <= 5;
}

function diasUteisUltimoAno() {
  const dias = [];
  const hoje = new Date();
  for (let i = 365; i >= 1; i--) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() - i);
    if (isDiaUtil(d)) dias.push(new Date(d));
  }
  return dias;
}

function formatarData(date) {
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function horaExpediente(baseDate) {
  const d = new Date(baseDate);
  d.setHours(rand(7, 17));
  d.setMinutes(rand(0, 59));
  d.setSeconds(rand(0, 59));
  d.setMilliseconds(rand(0, 999));
  return d;
}

// ── Leitura dos dados ──────────────────────────────────────────────────────
console.log('📂 Lendo caixas_index.json...');
const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

console.log('📂 Lendo config_erp.json...');
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const responsaveis = config.responsaveis || [];

const preparadores    = responsaveis.filter(r => r.funcao === 'Preparador' || r.funcao === 'Preparador Chefe');
const digitalizadores = responsaveis.filter(r => r.funcao === 'Digitalizador');

console.log(`\n👷 Preparadores   (${preparadores.length}):`,   preparadores.map(r => r.nome).join(', '));
console.log(`💻 Digitalizadores (${digitalizadores.length}):`, digitalizadores.map(r => r.nome).join(', '));

if (!preparadores.length || !digitalizadores.length) {
  console.error('❌ Nenhum preparador ou digitalizador encontrado.');
  process.exit(1);
}

// ── Selecionar caixas "Guardada" ────────────────────────────────────────────
const guardadas = index.filter(c => c.status === 'Guardada');
console.log(`\n📦 Caixas com status "Guardada": ${guardadas.length}`);

// ── Dias úteis ─────────────────────────────────────────────────────────────
const diasUteis = diasUteisUltimoAno();
console.log(`📅 Dias úteis no período: ${diasUteis.length}`);

let filaPreparo       = [...guardadas];
let filaDigitalizacao = [];
const caixasParaAtualizar = new Map();

// ── Fase 1: Preparação ──────────────────────────────────────────────────────
console.log('\n🔨 Fase 1: Distribuindo preparações...');
let totalPreparadas = 0;

for (const dia of diasUteis) {
  if (!filaPreparo.length) break;
  for (const prep of preparadores) {
    if (!filaPreparo.length) break;
    const qtd   = gerarCaixasDia(PREP_MIN, PREP_MAX, PREP_RARO, 0.03);
    const batch = filaPreparo.splice(0, Math.min(qtd, filaPreparo.length));
    for (const caixaIdx of batch) {
      const dataOp = horaExpediente(dia);
      const entrada = {
        caixa:      caixaIdx.caixa,
        prateleira: caixaIdx.prateleira,
        nivel:      caixaIdx.nivel,
        espaco:     caixaIdx.espaco,
        unidade:    caixaIdx.unidade,
        validade:   caixaIdx.validade,
        processos:  caixaIdx.processos,
        status:     'Preparada',
        usuario:    prep.nome,
        dataUpdate: formatarData(dataOp),
        dataISO:    dataOp.toISOString(),
        documentos: caixaIdx.documentos || 0,
        historico: [{
          quandoISO:     dataOp.toISOString(),
          tipo:          'edicao',
          registradoPor: prep.nome,
          mudancas: [
            { campo: 'status',  label: 'Status',      de: 'Guardada',  para: 'Preparada' },
            { campo: 'usuario', label: 'Responsável', de: '',          para: prep.nome }
          ]
        }]
      };
      caixasParaAtualizar.set(caixaIdx.caixa, entrada);
      filaDigitalizacao.push({ ...caixaIdx, preparadoPor: prep.nome, dataPreparacao: dataOp });
      totalPreparadas++;
    }
  }
}

console.log(`   ✅ Total preparadas: ${totalPreparadas}`);
console.log(`   📬 Fila para digitalizar: ${filaDigitalizacao.length}`);
console.log(`   📦 Ainda guardadas (não couberam): ${filaPreparo.length}`);

// ── Fase 2: Digitalização ──────────────────────────────────────────────────
console.log('\n💻 Fase 2: Distribuindo digitalizações...');
let totalDigitalizadas = 0;

const diasParaDigitalizar = diasUteis.slice(Math.floor(diasUteis.length * 0.15));

for (const dia of diasParaDigitalizar) {
  if (!filaDigitalizacao.length) break;
  for (const dig of digitalizadores) {
    if (!filaDigitalizacao.length) break;
    const qtd   = gerarCaixasDia(DIG_MIN, DIG_MAX, DIG_RARO, 0.04);
    const batch = filaDigitalizacao.splice(0, Math.min(qtd, filaDigitalizacao.length));
    for (const caixaRef of batch) {
      let dataOp = horaExpediente(dia);
      const dataPrep = new Date(caixaRef.dataPreparacao);
      if (dataOp <= dataPrep) {
        dataOp = new Date(dataPrep.getTime() + rand(1, 72) * 3600000);
      }
      const docs = gerarDocs();
      const entrada = caixasParaAtualizar.get(caixaRef.caixa);
      if (entrada) {
        entrada.historico.push({
          quandoISO:     dataOp.toISOString(),
          tipo:          'edicao',
          registradoPor: dig.nome,
          mudancas: [
            { campo: 'status',     label: 'Status',           de: 'Preparada',           para: 'Digitalizada' },
            { campo: 'usuario',    label: 'Responsável',      de: caixaRef.preparadoPor, para: dig.nome },
            { campo: 'documentos', label: 'Qtd. Documentos',  de: '0',                   para: String(docs) }
          ]
        });
        entrada.status     = 'Digitalizada';
        entrada.usuario    = dig.nome;
        entrada.dataUpdate = formatarData(dataOp);
        entrada.dataISO    = dataOp.toISOString();
        entrada.documentos = docs;
      }
      totalDigitalizadas++;
    }
  }
}

console.log(`   ✅ Total digitalizadas: ${totalDigitalizadas}`);
console.log(`   📬 Ainda só preparadas (não couberam): ${filaDigitalizacao.length}`);

// ── Aplicar mudanças nos arquivos de prateleiras ───────────────────────────
console.log('\n💾 Aplicando alterações nos arquivos de prateleiras...');

const porPrateleira = new Map();
for (const [caixaId, dados] of caixasParaAtualizar) {
  const prat = dados.prateleira;
  if (!prat) continue;
  if (!porPrateleira.has(prat)) porPrateleira.set(prat, []);
  porPrateleira.get(prat).push({ caixaId, dados });
}

let arquivosAtualizados = 0;
let caixasGravadas      = 0;
const total = porPrateleira.size;
let atual   = 0;

for (const [prat, entradas] of porPrateleira) {
  atual++;
  if (atual % 200 === 0 || atual === total) {
    process.stdout.write(`\r   Prateleiras: ${atual}/${total}  `);
  }

  const arquivo = path.join(PRATELEIRAS, `prateleira_${prat}.json`);
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (e) { lista = []; }

  const mapaLista = new Map(lista.map(c => [String(c.caixa).trim().toLowerCase(), c]));

  for (const { caixaId, dados } of entradas) {
    const key = String(caixaId).trim().toLowerCase();
    if (mapaLista.has(key)) {
      const caixa = mapaLista.get(key);
      caixa.status     = dados.status;
      caixa.usuario    = dados.usuario;
      caixa.dataUpdate = dados.dataUpdate;
      caixa.documentos = dados.documentos;
      if (!Array.isArray(caixa.historico)) caixa.historico = [];
      for (const h of dados.historico) {
        const jaExiste = caixa.historico.some(e => e.quandoISO === h.quandoISO);
        if (!jaExiste) caixa.historico.push(h);
      }
    } else {
      lista.push({
        caixa:      dados.caixa,
        unidade:    dados.unidade,
        validade:   dados.validade,
        prateleira: dados.prateleira,
        nivel:      dados.nivel,
        espaco:     dados.espaco,
        processos:  dados.processos || [],
        status:     dados.status,
        usuario:    dados.usuario,
        dataUpdate: dados.dataUpdate,
        documentos: dados.documentos,
        historico:  dados.historico
      });
    }
    caixasGravadas++;
  }

  fs.writeFileSync(arquivo, JSON.stringify(lista, null, 2), 'utf8');
  arquivosAtualizados++;
}
process.stdout.write('\n');

// ── Atualizar caixas_index.json ────────────────────────────────────────────
console.log('\n📝 Atualizando caixas_index.json...');
let idxAtualizadas = 0;
for (let i = 0; i < index.length; i++) {
  const c = index[i];
  if (caixasParaAtualizar.has(c.caixa)) {
    const dados      = caixasParaAtualizar.get(c.caixa);
    index[i].status     = dados.status;
    index[i].usuario    = dados.usuario;
    index[i].dataUpdate = dados.dataUpdate;
    index[i].documentos = dados.documentos;
    idxAtualizadas++;
  }
}
fs.writeFileSync(INDEX_FILE, JSON.stringify(index), 'utf8');
console.log(`   ✅ ${idxAtualizadas} entradas atualizadas no índice`);

// ── Relatório final ────────────────────────────────────────────────────────
const statusFinal = {};
index.forEach(c => { statusFinal[c.status] = (statusFinal[c.status] || 0) + 1; });

console.log('\n════════════════════════════════════════');
console.log('          RESULTADO FINAL');
console.log('════════════════════════════════════════');
console.log(`📁 Arquivos de prateleiras atualizados : ${arquivosAtualizados}`);
console.log(`📦 Caixas gravadas nos arquivos        : ${caixasGravadas}`);
console.log(`🔨 Caixas preparadas no período        : ${totalPreparadas}`);
console.log(`💻 Caixas digitalizadas no período     : ${totalDigitalizadas}`);
console.log(`📊 Distribuição final do índice:`);
Object.entries(statusFinal).forEach(([s, n]) => console.log(`   ${s.padEnd(15)}: ${n.toLocaleString('pt-BR')}`));
console.log('════════════════════════════════════════');
console.log('\n✅ Banco de dados povoado com sucesso!');
console.log('   Recarregue o sistema no navegador para ver as alterações.\n');
