var assert = require('chai').assert;
var myJson = require('../../main');

describe('Read-/write-only (reading)', function () {
	it('Reading read-only columns', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			},
			readOnly: {
				'string/other': 'other'
			}
		});
		
		var queryCalled = false;
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCalled = true;
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
			setTimeout(function () {
				callback(null, [{id_column: 5, name_column: 'test', other: 'test2'}]);
			}, 10);
		});

		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.search({}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.isTrue(queryCalled);
			assert.deepEqual(results[0], {id: 5, name: 'test', other: 'test2'});
			done(error);
		});
	});

	it('Ignore write-only columns', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			},
			writeOnly: {
				'string/other': 'other'
			}
		});
		
		var queryCalled = false;
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCalled = true;
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
			setTimeout(function () {
				callback(null, [{id_column: 5, name_column: 'test', other: 'test2'}]);
			}, 10);
		});

		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.search({}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.isTrue(queryCalled);
			assert.deepEqual(results[0], {id: 5, name: 'test'});
			done(error);
		});
	});

	it('Ignore unknown columns', function (done) {
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
				callback(null, [{id_column: 5, name_column: 'test', other: 'test2'}]);
			}, 10);
		});

		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.search({}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.isTrue(queryCalled);
			assert.deepEqual(results[0], {id: 5, name: 'test'});
			done(error);
		});
	});
});
