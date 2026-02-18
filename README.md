# HubPessoal (PWA offline-first)

Hub pessoal com 4 módulos, 100% offline no client:

1. Analytics e-soccer via importação Excel (.xlsx)
2. Notas / Objetivos / Checklist (CRUD)
3. Calendário / Lembretes com feriados BR offline
4. Área confidencial com senha mestra + AES-GCM

## Stack

- Next.js (App Router) + React + TypeScript
- CSS global premium + componentes reutilizáveis
- IndexedDB com Dexie
- Zustand para estado global simples
- SheetJS (`xlsx`) para import/export Excel
- date-fns
- Web Crypto API (PBKDF2 + AES-GCM)

## Rotas

- `/import`
- `/dashboard`
- `/h2h`
- `/player/[nick]`
- `/notes`
- `/calendar`
- `/secure`
- `/secure/strategies`
- `/secure/secret-notes`

## Como rodar

```bash
npm install
npm run dev
```

Abrir: `http://localhost:3000`.

Build de validação:

```bash
npm run build
```

## PWA e offline

- Manifest em `public/manifest.webmanifest`
- Service Worker em `public/sw.js`
- Registro automático no layout + shell premium
- Dados persistidos localmente no IndexedDB (`hubpessoal-db-v1`, schema Dexie v2)
- Não há chamadas para APIs externas

## Front premium (Command Center)

- App shell com sidebar fixa no desktop e drawer no mobile
- Topbar com breadcrumbs/título, busca e ações
- FilterBar com chips/selects + presets de filtros em IndexedDB
- Dashboard em grid 12 colunas com glass cards, rankings, próximos jogos e tabela premium
- Intervalos de confiança (IC95%) e amostra efetiva para métricas-chave
- Backtest offline de picks (hit-rate em recorte recente)
- Insights explicáveis com justificativa numérica (diferença vs liga, tendência recente)
- Tema dark/light via `data-theme` e persistência local

Arquivos principais de UI:

- `src/styles/premium.css`
- `src/components/shell/AppShell.tsx`
- `src/components/shell/Sidebar.tsx`
- `src/components/shell/Topbar.tsx`
- `src/components/ui/*`
- `src/hooks/useTheme.ts`
- `src/hooks/useMobileSidebar.ts`
- `src/hooks/useHotkeys.ts`
- `src/store/appStore.ts`

## Importação Excel

Na tela `/import`:

1. Clique em **Selecionar Arquivo** para importar `.xlsx`
2. O sistema valida abas e colunas
3. Limpeza aplicada:
	- Ignora linhas sem placar
	- Se `Status` existir e for diferente de `FINISHED`, ignora
	- Remove duplicados
  - Detecta outliers (`totalGoals > 20`) para painel Data Quality
4. Salva dataset raw no IndexedDB
5. Calcula cache de dashboard
6. Redireciona automaticamente para `/dashboard`

Botão **Baixar Modelo Excel (V1)** gera planilha vazia com schema correto.

## Schema Excel (V1)

### Aba `HISTORICO` (obrigatória)

Colunas:

- `League`
- `DateTime`
- `HomeTeam`
- `HomeNick`
- `AwayTeam`
- `AwayNick`
- `HomeGoals`
- `AwayGoals`
- `Status` (opcional)
- `OddHomeClose` (opcional)
- `OddDrawClose` (opcional)
- `OddAwayClose` (opcional)
- `OddOverClose` (opcional)
- `OddUnderClose` (opcional)
- `OuLineClose` (opcional)
- `FirstGoalMinute` (opcional)
- `FirstGoalType` (opcional)
- `RedCardsHome` (opcional)
- `RedCardsAway` (opcional)
- `HomeStartersOut` (opcional)
- `AwayStartersOut` (opcional)
- `HomeRestDays` (opcional)
- `AwayRestDays` (opcional)
- `HomeBackToBack` (opcional: `1/0`, `true/false`, `sim/não`)
- `AwayBackToBack` (opcional: `1/0`, `true/false`, `sim/não`)

### Aba `PROXIMOS` (opcional)

- `League`
- `DateTime`
- `HomeTeam`
- `HomeNick`
- `AwayTeam`
- `AwayNick`

### Aba `ODDS_1X2` (opcional)

- `League`
- `DateTime`
- `HomeNick`
- `AwayNick`
- `OddHome`
- `OddDraw`
- `OddAway`

### Aba `ODDS_OU` (opcional)

- `League`
- `DateTime`
- `HomeNick`
- `AwayNick`
- `Line` (2.5..7.5)
- `OddOver`
- `OddUnder`

### Aba `CONFIG` (opcional)

- `RecencyFactor` (default `0.85`)
- `ShrinkK` (default `6`)
- `Simulations` (default `20000`)
- `MinGamesConfidence` (default `5`)

### Aba `PLAYERS` (opcional)

- `Nick`
- `DisplayName`

## Segurança da área confidencial

- Criação de senha mestra em `/secure` (primeiro acesso)
- Derivação de chave com PBKDF2 + salt
- Verificação local por hash derivado
- Dados de `strategies` e `secret-notes` armazenados criptografados com AES-GCM no IndexedDB
- Auto-lock configurável no gate (`/secure`) + botão “Bloquear agora”

## Estrutura de dados no IndexedDB

- Dataset raw + import summary + data quality: `rawDatasets`
- Cache computado do dashboard: `computedCache`
- Presets de filtros: `presets`
- Avatares de jogador: `avatars`
- Vault seguro: `secureMeta` e `secureItems`

## Precisão analítica (novidades)

- `n efetivo` com recência (amostra ponderada) exibido no dashboard/player
- `IC95%` para BTTS e Over da linha selecionada
- Backtest offline para Top Picks de Over com baseline aleatório e baseline da liga (uplift em pp)
- Score único de decisão (0–100) com modos `conservador` e `agressivo`
- Regra anti-falso-sinal para bloquear sinais frágeis (score/amostra/intervalo/backtest)
- Filtro `Apostáveis` para ocultar picks fracos no recorte atual
- Card `Resumo executivo` com leitura rápida do cenário atual
- Alertas de edge frágil quando diferença player vs liga é pequena
- Data quality por liga (jogos, outliers e datas futuras)
- Botões do dashboard funcionais: `Detalhar`, `Ver completo`, `Abrir lista`, `CSV`, `Fixar`

## Confronto Direto (H2H)

Rota: `/h2h`

Permite informar:

- Jogador A (obrigatório)
- Jogador B (obrigatório)
- Time do Jogador A (opcional)
- Time do Jogador B (opcional)

Entregas da tela:

- Histórico de jogos entre os dois jogadores
- Resumo de vitórias/empates no confronto direto
- Métricas H2H (média de gols, BTTS e Over da linha)
- Análise separada de cada jogador contra outros adversários
- Score H2H final (0–100) com nível (`favoravel`, `cautela`, `evitar`)
- Peso por recência no H2H (métricas brutas e ponderadas)
- Split por mando para cada jogador (mandante vs visitante)
- Common Opponents (comparação dos dois contra os mesmos adversários)
- Selo de confiança da amostra (`Alta`, `Média`, `Baixa`)
- Filtro de janela dos últimos confrontos (`5`, `10`, `20`, `all`)
- Tendência visual de gols por confronto (mini gráfico)
- Probabilidades sugeridas com faixa de confiança (IC95%)
- Recomendação textual curta com 3 motivos explicáveis
- Exportação completa do relatório H2H em CSV

