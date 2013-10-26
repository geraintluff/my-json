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
		
		TestClass.search(fakeConnection, {}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.instanceOf(results[0], TestClass);
			assert.deepEqual(results[0], {id: 5, name: 'test'});
			done(error);
		});
	});

	it('parse JSON columns', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column',
				'json/prop1': 'prop1_json'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
			setTimeout(function () {
				callback(null, [{id_column: 5, name_column: 'test', 'prop1_json': JSON.stringify([1, 2, 3])}]);
			}, 10);
		});
		
		TestClass.search(fakeConnection, {}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.instanceOf(results[0], TestClass);
			assert.deepEqual(results[0], {id: 5, name: 'test', prop1: [1, 2, 3]});
			done(error);
		});
	});

	it('parse JSON columns in correct order', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column',
				'json': 'additional_json'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
			setTimeout(function () {
				callback(null, [{additional_json: '{"extraProp":true}', id_column: 5, name_column: 'test'}]);
			}, 10);
		});
		
		TestClass.search(fakeConnection, {}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.instanceOf(results[0], TestClass);
			assert.deepEqual(results[0], {id: 5, name: 'test', extraProp: true});
			done(error);
		});
	});

	it('open() using key column', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 5'), sql);
			setTimeout(function () {
				callback(null, [{id_column: 5, name_column: 'test'}]);
			}, 10);
		});
		
		TestClass.open(fakeConnection, 5, function (error, result) {
			assert.instanceOf(result, TestClass);
			assert.deepEqual(result, {id: 5, name: 'test'});
			done(error);
		});
	});

	it('open() with no result', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 10'), sql);
			setTimeout(function () {
				callback(null, []);
			}, 10);
		});
		
		TestClass.open(fakeConnection, 10, function (error, result) {
			assert.isUndefined(result);
			done(error);
		});
	});

	it('open() using key columns (cast string/number)', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			keyColumns: ['integer/id', 'string/name'],
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			assert.isTrue(myJson.sqlMatchPattern(sql, [
				'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id_column` = 5 AND {t}.`name_column` = \'test\')',
				'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`name_column` = \'test\' AND {t}.`id_column` = 5)'
			]), sql);
			setTimeout(function () {
				callback(null, [{id_column: 5, name_column: 'test'}]);
			}, 10);
		});
		
		TestClass.open(fakeConnection, '5', 'test', function (error, result) {
			assert.instanceOf(result, TestClass);
			assert.deepEqual(result, {id: 5, name: 'test'});
			done(error);
		});
	});
});
