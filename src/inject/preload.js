"use strict";
const {ipcRenderer, webFrame} = require('electron');
const MenuHandler = require('../handlers/menu');
const ShareMenu = require('./share_menu');
const MentionMenu = require('./mention_menu');
const BadgeCount = require('./badge_count');
const Common = require("../common");
const HistoryManager = require('../handlers/history_manager');


class Injector {
  init() {
    if (Common.DEBUG_MODE) {
      Injector.lock(window, 'console', window.console);
    }
    this.initInjectBundle();
    this.initAngularInjection();
    webFrame.setZoomLevelLimits(1, 1);

    new MenuHandler().create();

    this.historyManager = new HistoryManager();
  }

  initAngularInjection() {
    let self = this;
    let angular = window.angular = {};
    let angularBootstrapReal;
    Object.defineProperty(angular, 'bootstrap', {
      get: () => angularBootstrapReal ? function (element, moduleNames) {
        const moduleName = 'webwxApp';
        if (moduleNames.indexOf(moduleName) < 0) return;
        let constants = null;
        angular.injector(['ng', 'Services']).invoke(['confFactory', (confFactory) => (constants = confFactory)]);
        angular.module(moduleName).config(['$httpProvider', ($httpProvider) => {
          $httpProvider.defaults.transformResponse.push((value)=> {
            return self.transformResponse(value, constants);
          });
        }
        ]).run(['$rootScope', ($rootScope) => {
          ipcRenderer.send("wx-rendered", MMCgi.isLogin);

          $rootScope.$on("newLoginPage", () => {
            ipcRenderer.send("user-logged", "");
          });
          $rootScope.shareMenu = ShareMenu.inject;
          $rootScope.mentionMenu = MentionMenu.inject;

          $rootScope.$on('root:pageInit:success', function(){
            $rootScope.$on("message:add:success", function(e, oMessage){
              self.saveChatHistory(oMessage);
            });

            var timer = 0;
            $rootScope.$on("mmRepeat:change", function(){
              if(timer){
                clearTimeout(timer);
              }
              
              timer = setTimeout(function(){
                self.restoreChatHistory(angular.element('#chatArea').scope().currentUser);   
              }, 100);
            });
          });

        }]);
        return angularBootstrapReal.apply(angular, arguments);
      } : angularBootstrapReal,
      set: (real) => (angularBootstrapReal = real)
    });
  }

  getStableUserId(userName) {
    const contact = window._contacts[userName];
    return `${contact.NickName}_&&_${contact.RemarkName}`;
  }

  getActualSender(oMessage) {
    for (let userName in window._contacts) {
      let contact = window._contacts[userName];
      if(contact.NickName === oMessage.NickName && contact.RemarkName === oMessage.RemarkName){
        return contact.UserName;
      }
    }
  }

  saveChatHistory(oMessage) {
    const contact = window._contacts[oMessage.MMPeerUserName];
    var oMessage2 = angular.copy(oMessage);
    oMessage2.NickName = contact.NickName;
    oMessage2.RemarkName = contact.RemarkName;
    delete oMessage2.RecommendInfo;
    
    // see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm#Things_that_don%27t_work_with_structured_clones
    // we must delete "oMessage2.MMCancelUploadFileFunc" right now. To check every property of oMessage2 is better/safer strategy. 
    // This is tight with and limited by current history_manager's storage backend(IndexedDB).
    for(let key in oMessage2){
      if(oMessage2.hasOwnProperty(key) && typeof oMessage[key] === 'function'){
        delete oMessage2[key];
      }
    }

    this.historyManager.saveHistory(oMessage2);
  }

  restoreChatHistory(userName) {
    if(!userName){
      return;
    }
    var self = this;
    var chatContent = window._chatContent[userName];
    self.historyManager.getHistory(self.getStableUserId(userName)).then(function(history){
      history = history || [];
      history.forEach(function(oMessage){
        oMessage.MMStatus = 0;
        oMessage.MMUnread = false;
        oMessage.MMActualSender = oMessage.MMPeerUserName = self.getActualSender(oMessage);
      });
      if(!window._chatContent[userName] || window._chatContent[userName].length === 0){
        window._chatContent[userName] = angular.element('#chatArea').scope().chatContent = history;
      }
    });
  }

  initInjectBundle() {
    let initModules = ()=> {
      if (!window.$) {
        return setTimeout(initModules, 3000);
      }

      MentionMenu.init();
      BadgeCount.init();
    };

    window.onload = () => {
      initModules();
      window.addEventListener('online', ()=> {
        ipcRenderer.send('reload', true);
      });
    };
  }

  transformResponse(value, constants) {
    if (!value) return value;

    switch (typeof value) {
      case 'object':
        /* Inject emoji stickers and prevent recalling. */
        return this.checkEmojiContent(value, constants);
      case 'string':
        /* Inject share sites to menu. */
        return this.checkTemplateContent(value);
    }
    return value;
  }

  static lock(object, key, value) {
    return Object.defineProperty(object, key, {
      get: () => value,
      set: () => {
      }
    });
  }

  checkEmojiContent(value, constants) {
    if (!(value.AddMsgList instanceof Array)) return value;
    value.AddMsgList.forEach((msg) => {
      switch (msg.MsgType) {
        case constants.MSGTYPE_EMOTICON:
          Injector.lock(msg, 'MMDigest', '[Emoticon]');
          Injector.lock(msg, 'MsgType', constants.MSGTYPE_EMOTICON);
          if (msg.ImgHeight >= Common.EMOJI_MAXIUM_SIZE) {
            Injector.lock(msg, 'MMImgStyle', {height: `${Common.EMOJI_MAXIUM_SIZE}px`, width: 'initial'});
          } else if (msg.ImgWidth >= Common.EMOJI_MAXIUM_SIZE) {
            Injector.lock(msg, 'MMImgStyle', {width: `${Common.EMOJI_MAXIUM_SIZE}px`, height: 'initial'});
          }
          break;
        case constants.MSGTYPE_RECALLED:
          Injector.lock(msg, 'MsgType', constants.MSGTYPE_SYS);
          Injector.lock(msg, 'MMActualContent', Common.MESSAGE_PREVENT_RECALL);
          Injector.lock(msg, 'MMDigest', Common.MESSAGE_PREVENT_RECALL);
          break;
      }
    });
    return value;
  }

  checkTemplateContent(value) {
    let optionMenuReg = /optionMenu\(\);/;
    let messageBoxKeydownReg = /editAreaKeydown\(\$event\)/;
    if (optionMenuReg.test(value)) {
      value = value.replace(optionMenuReg, "optionMenu();shareMenu();");
    } else if (messageBoxKeydownReg.test(value)) {
      value = value.replace(messageBoxKeydownReg, "editAreaKeydown($event);mentionMenu($event);");
    }
    return value;
  }
}

new Injector().init();
