var assert = require('chai').assert;
var myJson = require('../../main');

describe('Class groups', function () {
	it('Open reference', function (done) {
		var classes = myJson.group({
			TestClass: {
				table: 'TestTable',
				keyColumns: 'integer/id',
				columns: {
					'integer/id': 'id',
					'string/name': 'name',
					'reference/other': {
						type: 'OtherClass',
						columns: {
							'integer/id': 'other_id'
						}
					}
				}
			},
			OtherClass: {
				table: 'OtherTable',
				keyColumn: 'integer/id',
				columns: {
					'integer/id': 'id',
					'string/name': 'name'
				}
			}
		});

		var queryCount = 0;
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCount++;
			if (queryCount === 1) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id` = 5'), sql);
				callback(null, [{id: 5, name: 'test', 'other_id': 23}]);
			} else if (queryCount === 2) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `OtherTable` {t} WHERE {t}.`id` = 23'), sql);
				callback(null, [{id: 23, name: 'other object'}]);
			} else {
				assert.fail(null, null, 'queryCount too high');
			}
		});
		
		classes.TestClass.open(fakeConnection, 5, function (err, result) {
			assert.notOk(err);
			assert.deepEqual(result, {
				id: 5,
				name: 'test',
				other: {
					id: 23,
					name: 'other object'
				}
			});
			assert.instanceOf(result, classes.TestClass);
			assert.instanceOf(result.other, classes.OtherClass);
			done(err);
		});
	});

	it('Open reference (cached)', function (done) {
		var classes = myJson.group({
			TestClass: {
				table: 'TestTable',
				keyColumns: 'integer/id',
				columns: {
					'integer/id': 'id',
					'string/name': 'name',
					'reference/other': {
						type: 'OtherClass',
						columns: {
							'integer/id': 'other_id'
						}
					}
				}
			},
			OtherClass: {
				table: 'OtherTable',
				keyColumn: 'integer/id',
				columns: {
					'integer/id': 'id',
					'string/name': 'name'
				}
			}
		});

		var queryCount = 0;
		var fakeConnection = myJson.FakeConnection(function (sql, callback) {
			queryCount++;
			if (queryCount === 1) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id` = 5'), sql);
				callback(null, [{id: 5, name: 'test', 'other_id': 23}]);
			} else if (queryCount === 2) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `OtherTable` {t} WHERE {t}.`id` = 23'), sql);
				callback(null, [{id: 23, name: 'other object'}]);
			} else {
				assert.fail(null, null, 'queryCount too high');
			}
		});
		
		var cached = classes.cacheWith(fakeConnection);
		
		cached.TestClass.open(5, function (err, result) {
			assert.notOk(err);
			assert.deepEqual(result, {
				id: 5,
				name: 'test',
				other: {
					id: 23,
					name: 'other object'
				}
			});
			assert.instanceOf(result, classes.TestClass);
			assert.instanceOf(result.other, classes.OtherClass);
			done(err);
		});
	});
	
	it('Open reference (pooled)', function (done) {
		var classes = myJson.group({
			TestClass: {
				table: 'TestTable',
				keyColumns: 'integer/id',
				columns: {
					'integer/id': 'id',
					'string/name': 'name',
					'reference/other': {
						type: 'OtherClass',
						columns: {
							'integer/id': 'other_id'
						}
					}
				}
			},
			OtherClass: {
				table: 'OtherTable',
				keyColumn: 'integer/id',
				columns: {
					'integer/id': 'id',
					'string/name': 'name'
				}
			}
		});

		var queryCount = 0;
		var fakePool = myJson.FakePool(function (sql, callback) {
			queryCount++;
			if (queryCount === 1) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id` = 5'), sql);
				callback(null, [{id: 5, name: 'test', 'other_id': 23}]);
			} else if (queryCount === 2) {
				assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `OtherTable` {t} WHERE {t}.`id` = 23'), sql);
				callback(null, [{id: 23, name: 'other object'}]);
			} else {
				assert.fail(null, null, 'queryCount too high');
			}
		});
		
		var cached = classes.cacheWithPool(fakePool);
		
		cached.TestClass.open(5, function (err, result) {
			assert.notOk(err);
			assert.deepEqual(result, {
				id: 5,
				name: 'test',
				other: {
					id: 23,
					name: 'other object'
				}
			});
			assert.instanceOf(result, classes.TestClass);
			assert.instanceOf(result.other, classes.OtherClass);
			done(err);
		});
	});
});
