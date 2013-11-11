var assert = require('chai').assert;
var myJson = require('../../main');

describe('Reading arrays', function () {
	it('parse simple object (separate ID column)', function (done) {
		// Disable for now
		return done();
		
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id_column',
				'string/name': 'name_column',
				'array/arr': {
					parentColumns: {
						'group': 'array_id'
					},
					type: {
						table: 'TestArrayTable',
						columns: {
							'group': 'group_id',
							'index': 'group_index',
							'integer': 'value',
						}
					}
				}
			}
		});
		
		var queryCount = 0;
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCount++;
			if (queryCount === 1) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
				callback(null, [{id_column: 5, name_column: 'test', array_id: 12345}]);
			} else if (queryCount === 2) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestArrayTable` {t} WHERE {t}.`group_id` = 12345 ORDER BY {t}.`group_index`'), sql);
				callback(null, [
					{group_id: 12345, index: 0, value: 1},
					{group_id: 12345, index: 1, value: 2},
					{group_id: 12345, index: 2, value: 3},
					{group_id: 12345, index: 3, value: 4},
					{group_id: 12345, index: 4, value: 5}
				]);
			} else {
				assert.fail(null, null, 'queryCount too high');
			}
		});
		
		TestClass.search(fakeConnection, {}, function (error, results) {
			assert.equal(queryCount, 2);
			assert.lengthOf(results, 1);
			assert.instanceOf(results[0], TestClass);
			assert.deepEqual(results[0], {id: 5, name: 'test', arr: [1, 2, 3, 4, 5]});
			done(error);
		});
	});
});
