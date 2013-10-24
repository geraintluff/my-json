var assert = require('chai').assert;
var myJson = require('../../main');

describe('Cache instances', function () {
	it('cache instances', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		var cached = TestClass.cache();
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
			setTimeout(function () {
				callback(null, [
					{id_column: 5, name_column: 'test'},
					{id_column: 5, name_column: 'test'}
				]);
			}, 10);
		});
		
		cached.search(fakeConnection, {}, function (error, results) {
			assert.lengthOf(results, 2);
			assert.instanceOf(results[0], TestClass);
			assert.equal(results[0], results[1]); // NOT deepEqual - we want actual equivalence
			
			done(error);
		});
	});
});
