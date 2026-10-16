# IA-COMERCIAL

Este é um projeto novo e independente. O usuário pediu para não alterar, configurar, executar nem copiar o sistema Ranking de Vendas. Trabalhe somente neste repositório.

## Requisitos do produto

- Instagram e Facebook já estão conectados à Kommo. Toda resposta ao cliente deve sair pelo canal nativo da Kommo, usando o Salesbot. Não substitua esse fluxo por envio direto à Meta.
- Enriqueça o lead recebido; não crie leads duplicados para cada mensagem.
- O roteiro em `qualification.json` foi conferido com `https://exodosaude.com/cotacao/`. Preserve as perguntas condicionais e a distinção entre triagem completa e qualificação comercial de MEI/empresa. Pessoa física também é atendida.
- O sistema reúne dados para um consultor. Não invente preços, cobertura, elegibilidade ou carências.
- Comentários públicos recebem convite ao chat privado. Não peça os dados da cotação publicamente.

## Desenvolvimento

Use Node 24 e o checkout existente. Cada tarefa já possui ambiente isolado; não crie Git worktree sem pedido explícito.

Instale com `npm ci`. Valide alterações com `npm test` e `npm run build`. Para alterações no widget, execute também `npm run package:widget`.

O padrão é simulação. Credenciais e dados locais não entram no Git. Testes usam adaptadores locais; não envie mensagens a clientes reais durante testes de desenvolvimento.
