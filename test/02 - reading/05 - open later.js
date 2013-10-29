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

	it('cached.forceQuery()', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});

		var queryCount = 0;
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCount++;
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 5'
			]), sql);
			setTimeout(function () {
				callback(null, [
					{id_column: 5, name_column: 'test'}
				]);
			}, 10);
		});
		
		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.openLater(5);
		
		cached.forceQuery(function (forcedErr, result) {
			assert.equal(queryCount, 1, 'single query (1)');
			cached.open(5, function (error, result) {
				assert.equal(queryCount, 1, 'single query (2)');
				assert.instanceOf(result, TestClass);
				assert.deepEqual(result, {id: 5, name: 'test'});
				done(error || forcedErr);
			});
		});
	});
	
	it('cached.openLater() with callback', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});

		var queryCount = 0;
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCount++;
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 5'
			]), sql);
			setTimeout(function () {
				callback(null, [
					{id_column: 5, name_column: 'test'}
				]);
			}, 10);
		});
		
		var cached = TestClass.cacheWith(fakeConnection);
		
		var callbackCalled = false;
		cached.openLater(5, function (result) {
			assert.instanceOf(result, TestClass);
			callbackCalled = true;
		});
		
		assert.isFalse(callbackCalled);
		cached.forceQuery(function (forcedErr, result) {
			assert.isTrue(callbackCalled);
			done(forcedErr);
		});
	});
});
