var assert = require('chai').assert;
var myJson = require('../../main');

describe('Catch insert ID', function () {
	it('plain integer id', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			},
			keyColumn: 'integer/id'
		});
		var queryCalled = false;
		var cache = TestClass.cacheWith(myJson.FakeConnection(function (sql, callback) {
			queryCalled = true;
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'INSERT INTO `TestTable` (`name_column`) VALUES (\'test\')',
				'INSERT INTO `TestTable` (`name_column`) VALUES (\'test\' )',
				'INSERT INTO `TestTable` (`name_column`) VALUES ( \'test\')',
				'INSERT INTO `TestTable` (`name_column`) VALUES ( \'test\' )'
			]), sql);
			setTimeout(function () {
				callback(null, {
					insertId: 12345
				});
			}, 10);
		}));

		var testObj = new TestClass();
		testObj.name = "test";
		cache.save(testObj, function (error, result) {
			assert.isTrue(queryCalled);
			assert.deepEqual(testObj, {name: 'test', id: 12345});
			done(error);
		});
	});
});
