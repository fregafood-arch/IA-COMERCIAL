# IA-COMERCIAL · Êxodo Saúde

Integração independente para qualificar conversas de Instagram e Facebook que **já chegam à Kommo**. O GPT interpreta as respostas; a aplicação atualiza o lead existente e devolve o texto ao **Salesbot**, que envia a mensagem pelo canal nativo da Kommo.

Não usa a API de envio da Meta e não cria outro lead para a mesma conversa. Não calcula preços nem promete condições de plano: reúne os dados para o consultor preparar a cotação.

## Executar e testar localmente

Requer Node.js 24 ou superior e npm. Para gerar o pacote do widget, também requer o comando `zip`.

```sh
npm ci
npm test
npm run build
npm run package:widget
npm start
```

O padrão é **simulação**, na porta 3000. Há um painel de teste na rota `/` e uma verificação de processo em `/health`. O painel aceita respostas no formato `chave: valor`; o botão **Preencher exemplo** demonstra uma triagem completa. Nenhuma API externa é chamada nesse modo. `npm run dev` inicia com recarga automática.

O modo conectado usa o SDK oficial OpenAI e Structured Outputs para interpretar linguagem natural. Os testes exercitam o SDK com respostas simuladas, o webhook HTTP, autenticação, persistência e os contratos da API Kommo. Ainda é necessário validar a integração dentro da conta real depois de configurar as credenciais e instalar o widget.

## Dados da cotação

O roteiro foi conferido com a [página de cotação](https://exodosaude.com/cotacao/) e o questionário público [`assets/quiz.js`](https://exodosaude.com/cotacao/assets/quiz.js). Fica em [qualification.json](qualification.json):

| Informação | Quando é necessária |
| --- | --- |
| Tipo: MEI, empresa ou pessoa física | Sempre |
| Tempo de abertura do CNPJ | MEI ou empresa |
| Situação profissional | Pessoa física |
| Quantidade de pessoas | Sempre |
| Idades de cada pessoa | Até dez pessoas; opcionais para grupos maiores |
| Estado e cidade | Sempre |
| Plano atual | Sempre |
| Faixa de gasto mensal atual | Quando já possui plano; aceita “prefiro não dizer” |
| Nome e WhatsApp | Sempre |
| E-mail e hospital/laboratório de preferência | Opcionais |

Interesse ou operadora mencionados espontaneamente também podem ser registrados. O roteiro não solicita diagnósticos, documentos ou pagamentos. A regra comercial do site identifica MEI/empresa como qualificados, mas também atende pessoa física; isso é separado de ter a triagem completa.

## Conectar à Kommo

Conta informada: `https://suporteexodosaudecom.kommo.com`.

1. Disponibilize esta aplicação com **HTTPS público**. Este repositório não faz deploy automaticamente.
2. Na Kommo, crie uma **integração privada** e envie `dist/kommo-widget.zip`. Configure a URL de redirecionamento da integração com a origem HTTPS da aplicação, usada para validar a audiência do JWT. O widget contém apenas configuração de fluxo, tradução e imagens; nenhuma credencial.
3. Forneça, no ambiente seguro da aplicação, os valores de `.env.example`: `GPT_API_KEY`, `KOMMO_ACCESS_TOKEN`, `KOMMO_CLIENT_SECRET`, `APP_PUBLIC_URL` e `ADMIN_TOKEN`. O token Kommo pode ser o token de longa duração dessa integração. O segredo do cliente precisa chegar como variável real ao processo, pois valida assinaturas localmente.
4. Configure `INTEGRATION_MODE=live`. O servidor recusa esse modo se faltarem requisitos. `KOMMO_INTEGRATION_ID` permite conferir também o UUID da integração no JWT.
5. Adicione o bloco **Qualificar com IA Comercial** ao Salesbot associado às mensagens recebidas do Instagram/Facebook. Informe a URL pública terminando em `/webhooks/kommo/salesbot`. Use `channel=instagram` ou `facebook` e `context=private_chat`.
6. Ligue a saída `collecting` a **aguardar uma nova mensagem** e, somente depois dela, volte ao widget. Ligue `ready` e `handoff` ao atendimento do consultor. Não retorne imediatamente ao widget sem receber uma mensagem: isso repetiria a mesma entrada.
7. Para comentários públicos, configure `context=public_comment`. A resposta convida para o privado; a saída `private_chat` deve seguir a automação nativa de comentários/conversas privadas disponível no canal da Kommo. A conexão da conta social, por si só, não comprova que comentários disparam o Salesbot: confira esse disparo na sua conta. A aplicação não tenta contornar isso enviando mensagens diretamente à Meta.

O bloco nativo `show` envia `{{json.reply}}` **na conversa atual do Salesbot**. Não selecionamos outro canal nem outro contato. Pedidos de atendimento humano e conversas já encaminhadas não continuam sendo triados automaticamente.

### Campos e etapa do lead

Os dados completos ficam em uma nota do **lead recebido**, sem criar outro. Para preencher também campos estruturados, crie/use campos de **texto** no lead e configure `KOMMO_FIELD_MAP` com IDs reais, por exemplo no formato `{"name":123,"whatsapp":456}`. Os números são apenas ilustrativos; descubra os IDs da conta antes de configurar.

Se quiser mover o lead ao concluir, informe juntos `KOMMO_PIPELINE_ID` e `KOMMO_READY_STATUS_ID`. Sem eles, a etapa atual é preservada. Tipos de campo como listas e enumerações precisam de um mapeamento específico antes de serem usados no lugar dos campos de texto.

## Contrato do webhook

```json
{
  "token": "JWT fornecido pela Kommo",
  "data": {
    "lead_id": "{{lead.id}}",
    "contact_id": "{{contact.id}}",
    "message": "{{message_text}}",
    "channel": "instagram",
    "context": "private_chat"
  },
  "return_url": "https://suporteexodosaudecom.kommo.com/api/v4/salesbot/123/continue/456"
}
```

O servidor valida o JWT HS256, emissor, audiência, conta, expiração e lead; grava a entrada em SQLite e responde HTTP 200 antes de executar GPT/CRM. O trabalho é assíncrono, respeitando o limite de dois segundos da Kommo.

A continuação usa exclusivamente o endereço validado da própria conta. Ela passa `data.reply`, `data.status`, `data.ready`, `data.send_reply`, `data.missing_fields`, `data.commercial_qualified` e `data.contract_type` para o bot. O texto é exibido pelo bloco nativo, sem usar `execute_handlers.show`, cujo limite documentado é de 80 caracteres.

## Persistência e operação

- SQLite mantém fila, perfil e até 40 mensagens recentes. Os padrões são `data/simulation.sqlite` para testes e `data/ia-comercial.sqlite` para live; um banco já marcado com um modo não pode ser aberto no outro. O histórico original também permanece na Kommo. O diretório `data/` é ignorado pelo Git e deve usar volume persistente em um deploy.
- O MVP usa **um processo por banco SQLite**, com processamento em sequência. Não suba réplicas compartilhando o mesmo arquivo. Volumes maiores podem migrar a fila/banco mantendo os adaptadores.
- O identificador da continuação impede reprocessar um webhook repetido. JWTs não são armazenados. Credenciais e textos de clientes não vão para logs de acesso.
- Uma resposta externa perdida pode ter sido aceita pela Kommo. Por isso, falhas e trabalhos interrompidos ficam em `needs_review`, sem reenviar mensagens automaticamente. A rota administrativa `/api/status` exige `Authorization: Bearer ADMIN_TOKEN` no modo conectado. Revise o estado da conversa na Kommo antes de reexecutar qualquer continuação.
- Cabeçalhos e chamadas usam verificação TLS. Node 24 respeita os proxies do ambiente com `--use-env-proxy`; não desabilite certificados.

## Referências utilizadas

- [Salesbot e `widget_request`](https://developers.kommo.com/docs/salesbot-dp)
- [Salesbot SDK](https://developers.kommo.com/docs/salesbot-sdk)
- [Continuação do Salesbot](https://developers.kommo.com/reference/salesbot-widget-block-execution-confirmation)
- [JWT de uso único](https://developers.kommo.com/docs/one-time-tokens)
- [Token de longa duração](https://developers.kommo.com/docs/long-lived-token)
- [Atualizar leads](https://developers.kommo.com/reference/updating-leads) e [adicionar notas](https://developers.kommo.com/reference/add-notes)
