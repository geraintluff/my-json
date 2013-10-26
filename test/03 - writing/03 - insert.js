var assert = require('chai').assert;
var myJson = require('../../main');

describe('Insert', function () {
	it('Catch insert id', function (done) {
		
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
	
	it('Re-attempt update as insert', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		var updateCalled = false;
		var insertCalled = false;
		var cache = TestClass.cacheWith(myJson.FakeConnection(function (sql, callback) {
			if (/^update/i.test(sql)) {
				updateCalled = true;
				return setTimeout(function () {
					return callback(null, {
						affectedRows: 0
					});
				}, 10);
			}
			insertCalled = true;
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'INSERT INTO `TestTable` (`id_column`, `name_column`) VALUES (1, \'test\')',
				'INSERT INTO `TestTable` (`name_column`, `id_column`) VALUES (\'test\', 1)',
			]), sql);
			setTimeout(function () {
				callback(null, {
					affectedRows: 1
				});
			}, 10);
		}));

		var testObj = new TestClass();
		testObj.id = 1;
		testObj.name = "test";
		cache.save(testObj, function (error, result) {
			assert.isTrue(updateCalled, 'update called');
			assert.isTrue(insertCalled, 'insert called');
			assert.deepEqual(testObj, {name: 'test', id: 1});
			done(error);
		});
	});

	it('Force insert', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		var updateCalled = false;
		var insertCalled = false;
		var cache = TestClass.cacheWith(myJson.FakeConnection(function (sql, callback) {
			if (/^update/i.test(sql)) {
				updateCalled = true;
				return setTimeout(function () {
					return callback(null, {
						affectedRows: 0
					});
				}, 10);
			}
			insertCalled = true;
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'INSERT INTO `TestTable` (`id_column`, `name_column`) VALUES (1, \'test\')',
				'INSERT INTO `TestTable` (`name_column`, `id_column`) VALUES (\'test\', 1)',
			]), sql);
			setTimeout(function () {
				callback(null, {
					affectedRows: 1
				});
			}, 10);
		}));

		var testObj = new TestClass();
		testObj.id = 1;
		testObj.name = "test";
		cache.save(testObj, true, function (error, result) {
			assert.isFalse(updateCalled, 'update called');
			assert.isTrue(insertCalled, 'insert called');
			assert.deepEqual(testObj, {name: 'test', id: 1});
			done(error);
		});
	});
});
