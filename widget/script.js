define([], function () {
  'use strict';
  return function () {
    function go(step) { return { handler: 'goto', params: { type: 'question', step: step } }; }
    function exit(code) { return { handler: 'exits', params: { value: code } }; }
    function condition(field, value, result) {
      return { handler: 'conditions', params: { logic: 'and', conditions: [
        { term1: '{{json.' + field + '}}', term2: value, operation: '=' }
      ], result: result } };
    }
    this.callbacks = {
      render: function () { return true; },
      init: function () { return true; },
      bind_actions: function () { return true; },
      settings: function () { return true; },
      onSave: function () { return true; },
      destroy: function () { return true; },
      salesbotDesignerSettings: function () {
        return { exits: [
          { code: 'collecting', title: 'Aguardar próxima mensagem' },
          { code: 'ready', title: 'Dados reunidos para cotação' },
          { code: 'handoff', title: 'Encaminhar ao consultor' },
          { code: 'private_chat', title: 'Continuar em conversa privada' }
        ] };
      },
      onSalesbotDesignerSave: function (_handler, params) {
        var endpoint = new URL(params.endpoint);
        if (endpoint.protocol !== 'https:') throw new Error('Use a URL HTTPS da aplicação.');
        var channel = ['instagram', 'facebook', 'kommo'].indexOf(params.channel) >= 0 ? params.channel : 'kommo';
        var context = params.context === 'public_comment' ? 'public_comment' : 'private_chat';
        return JSON.stringify([
          { question: [
            { handler: 'widget_request', params: { url: endpoint.href, data: {
              lead_id: '{{lead.id}}', contact_id: '{{contact.id}}', message: '{{message_text}}', channel: channel, context: context
            } } }, go(1)
          ] },
          { question: [condition('send_reply', 'yes', [go(2)]), go(3)] },
          { question: [
            // Native show responds in the Salesbot's current conversation.
            // Never send to Meta Graph or choose a different client channel.
            { handler: 'show', params: { type: 'text', value: '{{json.reply}}' } }, go(3)
          ] },
          { question: [
            condition('status', 'collecting', [exit('collecting')]),
            condition('status', 'ready', [exit('ready')]),
            condition('status', 'private_chat', [exit('private_chat')]),
            exit('handoff')
          ] }
        ]);
      }
    };
    return this;
  };
});
