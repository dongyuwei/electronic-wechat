const localforage = require('localforage');

class HistoryManager {
    saveHistory(peerUserName, oMessage) {
        localforage.getItem(peerUserName).then(function(/*Array*/history){
            history = history || [];
            history.push(oMessage);
            localforage.setItem(peerUserName, history);
        });
    }

    getHistory(peerUserName) {
        return localforage.getItem(peerUserName);
    }
}

module.exports = HistoryManager;