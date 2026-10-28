# Meu Mercado — Android (v1.0 alpha)

Aplicativo Android offline de acompanhamento de compras de supermercado, criado a partir do UX/UI do projeto Figma `Meu Mercado — UX/UI Android v1`.

## Funcionalidades implementadas

- Lista fixa com rolagem somente nos produtos, com nome, quantidade fracionada, unidade, preço unitário, subtotal e edição/exclusão.
- Foto do produto via câmera ou galeria, com miniatura na lista (a câmera retorna miniatura para máxima compatibilidade).
- Registro automático da data/hora da criação e conclusão da compra.
- Orçamento por compra, saldos por fonte (VA, VR, Pix, dinheiro, crédito), alerta ao ultrapassar o limite.
- Fechamento de compra dividido em diferentes meios de pagamento, com verificação da soma e dos saldos.
- Localização GPS opcional com permissão, nome e endereço preenchidos manualmente quando necessário.
- Histórico persistente com SQLite, edição manual posterior do estabelecimento e abertura do GPS em app de mapas externo.
- Estatísticas locais: total, média, gastos por mercado, produtos recorrentes e últimos preços.
- Recuperação automática da compra em andamento e funcionamento offline.

## Limitações desta versão

Esta é uma primeira versão funcional (alpha), **não** contempla ainda reconhecimento por IA da etiqueta, leitura automática de notas fiscais, leitura integrada de código de barras, sincronização entre celulares, backup remoto, relatórios PDF/Excel, despensa inteligente nem previsões avançadas. Não afirme que 26 funcionalidades estão concluídas.

O app usa câmera por `ACTION_IMAGE_CAPTURE` com miniatura de baixa/média resolução, não um arquivo de foto em resolução máxima. O mapa é aberto via aplicativo externo. O cálculo de valores utiliza centavos em `long` e quantidades fracionadas, com arredondamento ao centavo.

## Compilar localmente

Requisitos: JDK 17, Android SDK 35, Gradle 8.9. Na raiz do projeto:

```bash
gradle :app:assembleDebug
```

APK em `app/build/outputs/apk/debug/app-debug.apk`. O APK debug é assinado com chave de desenvolvimento e serve apenas para instalação/testes, não para distribuição pela Play Store.

## GitHub Actions

O workflow `.github/workflows/build-apk.yml` compila o APK debug e publica o artefato `MeuMercado-debug-apk` para baixar pela aba Actions do GitHub. Arquivos do app devem ficar na raiz do checkout para a automação funcionar. Não adicione senhas ou tokens ao código.

## Figma

https://www.figma.com/design/QkQ649ufqZh9tD8kmpV5Hf
