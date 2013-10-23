var assert = require('chai').assert;
var myJson = require('../../main');

describe('Basic query generation', function () {
	it('define MyJSON class', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		assert.isFunction(TestClass);
	});

	it('Simple fetch-all query', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE 1'), sql);
	});

	it('enum constraint (int)', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {
			type: 'object',
			properties: {
				'id': {'enum': [5]}
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id` = 5'), sql);
	});

	it('enum constraint (number)', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name',
				'number/blah': 'blah'
			}
		});
		
		var schema = {
			type: 'object',
			properties: {
				'blah': {'enum': [5]}
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`blah` = 5'), sql);
	});

	it('enum constraint (string)', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {
			type: 'object',
			properties: {
				'name': {'enum': ['test']}
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`name` = \'test\''), sql);
	});
});
