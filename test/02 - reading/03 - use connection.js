var assert = require('chai').assert;
var myJson = require('../../main');

describe('Bind to connection', function () {
	it('Bind to connection', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var queryCalled = false;
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCalled = true;
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
			setTimeout(function () {
				callback(null, [{id_column: 5, name_column: 'test'}]);
			}, 10);
		});

		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.search({}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.isTrue(queryCalled);
			
			done(error);
		});
	});
});
