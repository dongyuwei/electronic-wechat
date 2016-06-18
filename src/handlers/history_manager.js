const Dexie = require('dexie');

class HistoryManager {
    constructor() {
        this.db = new Dexie("wechat_history");
        this.db.version(1).stores({
            history: "++id,[NickName+RemarkName],Content"
        });
    }

    saveHistory(oMessage) {
        this.db.history.add(oMessage);
    }

    getHistory(peerUserName) {
        return this.db.history
            .where('[NickName+RemarkName]')
            .equals(peerUserName.split('_&&_'))
            .toArray();
    }
}

module.exports = HistoryManager;