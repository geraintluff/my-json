var assert = require('chai').assert;
var myJson = require('../../main');

describe('Bind to connection', function () {
	it('Bind to connection', function (done) {
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column'
			},
			keyColumn: 'integer/id'
		});
		
		var selected = false, updated = false;
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			if (/^select/i.test(sql)) {
				selected = true;
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
				setTimeout(function () {
					callback(null, [{id_column: 5, name_column: 'test'}]);
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
		
		var cached = TestClass.cacheWith(fakeConnection);
		
		cached.search({}, function (error, results) {
			assert.isTrue(selected);
			assert.lengthOf(results, 1);
			var testObj = results[0];
			cached.save(testObj, function (error, result) {
				done(error);
			});
		});
	});
});
