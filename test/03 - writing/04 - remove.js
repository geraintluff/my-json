var assert = require('chai').assert;
var myJson = require('../../main');

describe('Remove from database', function () {
	it('plain remove', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		var queryCalled = false;
		var cache = TestClass.cacheWith(myJson.FakeConnection(function (sql, callback) {
			queryCalled = true;
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'DELETE FROM `TestTable` WHERE `id_column`=5'
			]), sql);
			setTimeout(function () {
				callback(null, {});
			}, 10);
		}));

		var testObj = new TestClass();
		testObj.id = 5;
		testObj.name = "test";
		cache.remove(testObj, function (error, result) {
			assert.isTrue(queryCalled);
			assert.deepEqual(testObj, {name: 'test'});
			done(error);
		});
	});
});
