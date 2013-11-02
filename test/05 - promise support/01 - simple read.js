var assert = require('chai').assert;
var myJson = require('../../main');

describe('Simple reading', function () {
	it('parse simple object', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
			setTimeout(function () {
				callback(null, [{id_column: 5, name_column: 'test'}]);
			}, 10);
		});
		
		TestClass.search(fakeConnection, {}).then(function (results) {
			assert.lengthOf(results, 1);
			assert.instanceOf(results[0], TestClass);
			assert.deepEqual(results[0], {id: 5, name: 'test'});
			for (var i = 0; i < results.length; i++) {
				results[i] = results[i].id;
			}
			return results;
		}).then(function (results) {
			assert.deepEqual(results, [5]);
			done();
		});
	});

	it('openMultiple() using map', function (done) {
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
				'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id_column` = 5 OR {t}.`id_column` = 10)',
				'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id_column` = 10 OR {t}.`id_column` = 5)'
			]), sql);
			setTimeout(function () {
				callback(null, [
					{id_column: 10, name_column: 'test'},
					{id_column: 5, name_column: 'test'}
				]);
			}, 10);
		});
		
		TestClass.openMultiple(fakeConnection, {
			'five': 5,
			'ten': [10]
		}).then(function (result) {
			assert.instanceOf(result['five'], TestClass, 'five should be TestClass');
			assert.instanceOf(result['ten'], TestClass, 'ten should be TestClass');
			assert.deepEqual(result, {
				'five': {id: 5, name: 'test'},
				'ten': {id: 10, name: 'test'}
			});
			for (var key in result) {
				result[key] = result[key].id;
			}
			return result;
		}).then(function (result) {
			assert.deepEqual(result, {five: 5, ten: 10});
			done();
		});
	});
});
