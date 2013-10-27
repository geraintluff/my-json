var assert = require('chai').assert;
var myJson = require('../../main');

describe('Bind to connection', function () {
	it('Bind to connection', function (done) {
		
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
				callback(null, [{id_column: 5, name_column: 'test'}]);
			}, 10);
		});

		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.search({}, function (error, results) {
			assert.lengthOf(results, 1);
			assert.isTrue(queryCalled);
			
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
		
		var cached = TestClass.cacheWith(fakeConnection);
		cached.open(5, function (error, result) {
			assert.instanceOf(result, TestClass);
			assert.deepEqual(result, {id: 5, name: 'test'});
			done(error);
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
			if (myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 5')) {
				setTimeout(function () {
					callback(null, [
						{id_column: 5, name_column: 'test'}
					]);
				}, 10);
			} else {
				assert.isTrue(myJson.sqlMatchPattern(sql, [
					'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 10',
				]), sql);
				setTimeout(function () {
					callback(null, [
						{id_column: 10, name_column: 'test'}
					]);
				}, 10);
			}
		});
		
		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.open(5, function (fiveErr, fiveResult) {
			assert.instanceOf(fiveResult, TestClass, 'fiveResult should be a TestClass');

			cached.openMultiple({
				'five': 5,
				'ten': [10]
			}, function (error, result) {
				assert.equal(result['five'], fiveResult, 'should re-use cached instance');
				assert.instanceOf(result['five'], TestClass, 'five should be TestClass');
				assert.instanceOf(result['ten'], TestClass, 'ten should be TestClass');
				assert.deepEqual(result, {
					'five': {id: 5, name: 'test'},
					'ten': {id: 10, name: 'test'}
				});
				done(error || fiveErr);
			});
		});
	});
	
	it('openMultiple() using array', function (done) {
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			}
		});
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			if (myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 5')) {
				setTimeout(function () {
					callback(null, [
						{id_column: 5, name_column: 'test'}
					]);
				}, 10);
			} else {
				assert.isTrue(myJson.sqlMatchPattern(sql, [
					'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id_column` = 10',
				]), sql);
				setTimeout(function () {
					callback(null, [
						{id_column: 10, name_column: 'test'}
					]);
				}, 10);
			}
		});
		
		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.open(5, function (fiveErr, fiveResult) {
			assert.instanceOf(fiveResult, TestClass, 'fiveResult should be a TestClass');

			cached.openMultiple([10, 5], function (error, result) {
				assert.isArray(result);
				assert.equal(result[1], fiveResult, 'should re-use cached instance');
				assert.instanceOf(result[0], TestClass, 'five should be TestClass');
				assert.instanceOf(result[1], TestClass, 'ten should be TestClass');
				assert.deepEqual(result, [
					{id: 10, name: 'test'},
					{id: 5, name: 'test'}
				]);
				done(error || fiveErr);
			});
		});
	});
});
