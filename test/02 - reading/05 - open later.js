var assert = require('chai').assert;
var myJson = require('../../main');

describe('Delayed open', function () {
	it('cached.openLater() adds result to next open', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id_column` = 10 OR {t}.`id_column` = 5)',
				'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id_column` = 5 OR {t}.`id_column` = 10)'
			]), sql);
			setTimeout(function () {
				callback(null, [
					{id_column: 10, name_column: 'test'},
					{id_column: 5, name_column: 'test'}
				]);
			}, 10);
		});
		
		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.openLater(5);
		
		cached.open(10, function (error, result) {
			assert.instanceOf(result, TestClass);
			assert.deepEqual(result, {id: 10, name: 'test'});
			cached.open(5, function (error, result) {
				assert.instanceOf(result, TestClass);
				assert.deepEqual(result, {id: 5, name: 'test'});
				done(error);
			});
		});
	});
});
