var assert = require('chai').assert;
var myJson = require('../../main');

describe('Basic query generation', function () {
	it('parse JSON data', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var fakeConnection = {
			query: function (sql, callback) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
				setTimeout(function () {
					callback(null, [{id_column: 5, name_column: 'test'}]);
				}, 10);
			}
		};
		
		TestClass.search(fakeConnection, {}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.instanceOf(results[0], TestClass);
			assert.deepEqual(results[0], {id: 5, name: 'test'});
			done(error);
		});
	});
});
