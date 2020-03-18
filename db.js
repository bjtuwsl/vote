const sqlite = require('sqlite')


const dbPromise = sqlite.open(__dirname + '/db/voting-site1.sqlite3')

module.exports = dbPromise
