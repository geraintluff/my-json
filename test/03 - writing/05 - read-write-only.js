var assert = require('chai').assert;
var myJson = require('../../main');

describe('Read-/write-only (writing)', function () {
	it('Ignoring read-only columns', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			},
			readOnly: {
				'string/other': 'other'
			}
		});
		
		var selected = false, updated = false;
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			if (/^select/i.test(sql)) {
				selected = true;
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
				setTimeout(function () {
					callback(null, [{id_column: 5, name_column: 'test', other: 'other text'}]);
				}, 10);
			} else {
				updated = false;
				assert.isTrue(myJson.sqlMatchPattern(sql, [
					'UPDATE `TestTable` SET `name_column`=\'test\' WHERE `id_column`=5'
				]), sql);
				setTimeout(function () {
					callback(null);
				}, 10);
			}
		});
		
		TestClass.search(fakeConnection, {}, function (error, results) {
			assert.isTrue(selected);
			assert.lengthOf(results, 1);
			var testObj = results[0];
			assert.deepEqual(testObj, {id: 5, name: 'test', other: 'other text'});
			TestClass.save(fakeConnection, testObj, function (error, result) {
				done(error);
			});
		});
	});

	it('Writing write-only columns', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			keyColumn: 'integer/id',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			},
			writeOnly: {
				'string/other': 'other'
			}
		});
		
		var selected = false, updated = false;
		
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			if (/^select/i.test(sql)) {
				selected = true;
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
				setTimeout(function () {
					callback(null, [{id_column: 5, name_column: 'test', other: 'other text'}]);
				}, 10);
			} else {
				updated = false;
				assert.isTrue(myJson.sqlMatchPattern(sql, [
					'UPDATE `TestTable` SET `name_column`=\'test\', `other`=NULL WHERE `id_column`=5',
					'UPDATE `TestTable` SET `other`=NULL, `name_column`=\'test\' WHERE `id_column`=5'
				]), sql);
				setTimeout(function () {
					callback(null);
				}, 10);
			}
		});
		
		TestClass.search(fakeConnection, {}, function (error, results) {
			assert.isTrue(selected);
			assert.lengthOf(results, 1);
			var testObj = results[0];
			assert.deepEqual(testObj, {id: 5, name: 'test'});
			TestClass.save(fakeConnection, testObj, function (error, result) {
				done(error);
			});
		});
	});
});
