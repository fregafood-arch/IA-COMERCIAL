# Aplicação IA-COMERCIAL

`ia-comercial-aplicacao.zip` contém o backend completo, JavaScript compilado, fontes, painel de simulação, roteiro de cotação, testes e widget da Kommo. O pacote não contém `.env`, chaves, tokens, bancos SQLite, histórico de clientes ou `node_modules`.

O widget já enviado à Kommo é uma parte desta integração. O backend precisa ser instalado em um servidor para receber os webhooks e chamar o GPT.

## Situação da hospedagem

- Endereço planejado: `https://ia.exodosaude.com`.
- O usuário criou o subdomínio em pasta própria e emitiu o certificado no cPanel.
- HostGator Plano M, servidor `br694.hostgator.com.br`, SSH na porta `2222`, usuário `exodos55`.
- A conexão SSH foi encerrada antes da autenticação com `Not allowed at this time`. Chamado técnico: **2811477**.
- Ainda falta confirmar Node.js 24 e execução contínua pelo Passenger. A presença de Application Manager não comprova esses recursos.
- O pacote foi preparado para executar com Node.js; o carregamento e o ciclo de vida sob Passenger ainda precisam ser validados. Não basta cadastrar a pasta no Application Manager.

## Testar em computador ou servidor compatível

Requer Node.js 24 ou superior e npm. Extraia o ZIP em uma pasta própria e abra um terminal nessa pasta:

```sh
npm ci
npm test
npm start
```

O JavaScript já está compilado no pacote. Para recompilar após alterações, execute `npm run build`. Para testar no seu computador, abra a porta 3000 no navegador desse computador. A simulação aceita `chave: valor`, oferece o botão **Preencher exemplo** e não chama as APIs. Use os casos de `ROTEIRO-DE-TESTES.md`.

Para instalação somente de execução, `npm ci --omit=dev` instala as dependências de produção; nesse caso, os comandos de desenvolvimento e testes precisam da instalação completa. A execução do pacote extraído foi validada com as dependências de produção; a suíte automatizada foi executada no checkout com instalação completa.

## Publicar após a confirmação técnica

1. Use uma pasta exclusiva para o código, por exemplo `/home1/exodos55/ia-comercial`, separada da raiz pública `/home1/exodos55/ia.exodosaude.com`. O arquivo `.env` e o banco devem ficar fora da raiz pública. Não extraia o projeto por cima do site principal.
2. Instale as dependências com o lockfile. Configure somente um processo, com supervisão e diretório de trabalho na pasta da aplicação. A fila exige processo contínuo, inclusive quando não chegam requisições. Com Passenger, confirme o comando de inicialização, o suporte ao módulo ES e as configurações de encerramento por inatividade com o provedor.
3. Forneça as credenciais diretamente nas configurações protegidas da hospedagem. As variáveis cadastradas no ambiente de desenvolvimento não são automaticamente transferidas para a HostGator.
4. Configure HTTPS para chegar ao processo Node. O comando `npm start` usa porta 3000 em loopback por padrão. O Passenger pode exigir um mecanismo de inicialização próprio, a validar no servidor. Não abra a simulação na Internet com dados reais.
5. Reserve armazenamento persistente para `data/ia-comercial.sqlite` ou para o caminho configurado em `DATABASE_PATH`. Preserve e faça backup desse banco; não sobrescreva dados em atualizações. Não compartilhe o arquivo entre réplicas/processos.
6. Ative `INTEGRATION_MODE=live` somente depois que todos os valores exigidos estiverem preenchidos.

## Variáveis

| Nome | Valor ou origem |
| --- | --- |
| `APP_PUBLIC_URL` | `https://ia.exodosaude.com`, sem o caminho do webhook |
| `KOMMO_ACCOUNT_URL` | `https://suporteexodosaudecom.kommo.com` |
| `KOMMO_INTEGRATION_ID` | `bb6c0342-f35c-4f39-b536-c1752874b4b1` |
| `GPT_MODEL` | `gpt-4.1-mini` |
| `GPT_API_KEY` | Chave API OpenAI com permissão de escrita em Responses |
| `KOMMO_ACCESS_TOKEN` | Token de longa duração da integração privada |
| `KOMMO_CLIENT_SECRET` | Chave secreta da integração; variável direta ao processo para validar JWT |
| `ADMIN_TOKEN` | Valor aleatório criado pelo usuário; variável protegida direta ao processo |
| `INTEGRATION_MODE` | `simulation` para testes locais; `live` para a integração real |
| `KOMMO_FIELD_MAP` | Opcional: IDs reais de campos de texto do lead; o padrão é `{}` |
| `KOMMO_PIPELINE_ID` / `KOMMO_READY_STATUS_ID` | Opcionais: IDs reais, configurados juntos para mover a etapa |

Para gerar o `ADMIN_TOKEN` no PowerShell do seu computador e copiar diretamente para a área de transferência:

```powershell
$tokenBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
[Convert]::ToBase64String($tokenBytes) | Set-Clipboard
```

Cole com Ctrl+V no campo protegido `ADMIN_TOKEN`. Não envie o valor no chat, em capturas ou ao GitHub. Os 32 bytes aleatórios geram uma string Base64 com 44 caracteres.

## Conectar o Salesbot e conferir

- A origem de redirecionamento usada na integração Kommo deve corresponder a `APP_PUBLIC_URL`, conforme a validação de audiência do JWT.
- O endpoint do bloco será `https://ia.exodosaude.com/webhooks/kommo/salesbot`.
- Configure `channel=instagram` ou `facebook` e `context=private_chat` para chat; comentários usam `public_comment`, com encaminhamento nativo ao privado.
- A saída `collecting` deve esperar uma nova mensagem antes de retornar ao bloco. `ready` e `handoff` seguem para o consultor. `private_chat` segue para o fluxo nativo de conversa privada do canal.
- Confirme HTTPS e `GET /health` com `mode=live`. Esse endpoint comprova apenas que o processo está ativo; ainda é preciso testar JWT, GPT, atualização do lead e resposta pelo Salesbot com uma conversa de teste identificada.
- Não teste enviando mensagens a clientes reais. Complete os casos do roteiro com uma conta e conversa de teste.

O envio da resposta permanece no canal nativo da Kommo. O backend enriquece o lead recebido e não cria um novo lead para cada mensagem.
