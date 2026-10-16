# Roteiro de testes IA-COMERCIAL

Os casos locais abaixo usam dados fictícios, no simulador. O modo simulation interpreta `chave: valor`; a interpretação de linguagem natural pelo GPT será validada separadamente quando houver credenciais e ambiente de teste.

Abra uma **Nova conversa** para cada caso. Envie pelo painel ou por `POST /api/simulate` com um `lead_id` diferente em cada caso. A simulação não envia mensagens externas.

## Casos locais

### 1. Pessoa física com dados completos

```text
contract_type: pf; profession: clt; people_count: 2; ages: 32,30; state: sp; city: São Paulo; current_plan: nao; name: Cliente Fictício PF; whatsapp: 11999990000
```

Esperado: `ready`, nenhuma pendência e `commercial_qualified=no`. Pessoa física é atendida. A mensagem encaminha ao consultor sem prometer preços ou condições.

### 2. MEI sem tempo de CNPJ

```text
contract_type: mei; people_count: 2; ages: 34,30; state: sp; city: São Paulo; current_plan: nao; name: Cliente Fictício MEI; whatsapp: 11999990000
```

Esperado: `collecting`, com pendência `cnpj_age`. Na mesma conversa, enviar `cnpj_age: mais24` deve completar a triagem: `ready`, `commercial_qualified=yes`.

### 3. Empresa com plano atual e recusa de informar o gasto

```text
contract_type: empresa; cnpj_age: mais24; people_count: 2; ages: 40,35; state: sp; city: Campinas; current_plan: empresa; name: Cliente Fictício Empresa; whatsapp: 11999990000
```

Esperado: `collecting`, com pendência `current_cost`. Na mesma conversa, `current_cost: nd` deve permitir `ready`. A recusa de informar a faixa de gasto é aceita.

### 4. Quantidade de idades divergente

```text
contract_type: pf; profession: autonomo; people_count: 2; ages: 32; state: sp; city: Santos; current_plan: nao; name: Cliente Fictício Idades; whatsapp: 11999990000
```

Esperado: `collecting`, com pendência `ages`. Informar `ages: 32,30` na mesma conversa deve permitir `ready`.

### 5. Grupo com mais de dez pessoas

```text
contract_type: empresa; cnpj_age: mais24; people_count: 20; state: sp; city: São Paulo; current_plan: nao; name: Cliente Fictício Grupo; whatsapp: 11999990000
```

Esperado: `ready`, sem exigir a idade individual das vinte pessoas.

### 6. Comentário público

Selecione **Comentário público**, use Instagram ou Facebook e envie:

```text
Quero cotar um plano
```

Esperado: `private_chat`, convite ao chat privado e nenhuma chamada ao GPT para analisar o comentário. Não coletar dados de cotação publicamente.

### 7. Atendimento humano

Em uma nova conversa privada:

```text
Quero falar com um consultor
```

Esperado: `handoff`. Uma nova mensagem nessa mesma conversa deve manter o encaminhamento e não reiniciar a triagem automática.

### 8. WhatsApp inválido

```text
contract_type: pf; profession: clt; people_count: 2; ages: 32,30; state: sp; city: São Paulo; current_plan: nao; name: Cliente Fictício Telefone; whatsapp: 123
```

Esperado: `collecting`, com pendência `whatsapp`. Não completar a triagem com esse telefone inválido.

## Validação na conta real, após a hospedagem

Use uma conta social e um lead de teste definidos antes de habilitar o fluxo. Repita os cenários com frases naturais. Confirme na Kommo:

1. A conversa recebida pelo canal correto dispara o Salesbot e o webhook autentica.
2. As perguntas respeitam os campos condicionais e as correções fornecidas pelo cliente.
3. A resposta sai do mesmo chat nativo da Kommo; não há envio direto pela Meta.
4. O lead recebido é enriquecido, sem duplicação; os dados completos aparecem na nota de triagem e nos campos mapeados, quando configurados.
5. A saída collecting aguarda a próxima mensagem; ready/handoff encaminham ao consultor.
6. O canal oferece o disparo nativo para comentários e o encaminhamento privado esperado. A conexão das redes sociais, sozinha, não comprova esse recurso.
7. Reiniciar o serviço preserva dados. Operações de entrega incerta ficam needs_review para revisão, sem reenvio automático.

Testes locais não comprovam credenciais válidas, permissões reais, suporte da hospedagem ou envio pelo canal. Registre separadamente os resultados dessa etapa real.
