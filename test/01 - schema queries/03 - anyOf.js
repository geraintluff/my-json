var assert = require('chai').assert;
var myJson = require('../../main');

describe('anyOf queries', function () {
	it('separate enum constraint', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {
			anyOf: [
				{
					type: 'object',
					properties: {
						'id': {'enum': [5]}
					}
				},
				{
					type: 'object',
					properties: {
						'name': {'enum': ['test']}
					}
				}
			]
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` = 5 OR {t}.`name` = \'test\')'), sql);
	});

	it('not anyOf', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {
			not: {
				anyOf: [
					{
						type: 'object',
						properties: {
							'id': {'enum': [5]}
						}
					},
					{
						type: 'object',
						properties: {
							'name': {'enum': ['test']}
						}
					}
				]
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE ({t}.`id` != 5 AND {t}.`name` != \'test\')'), sql);
	});
	
});
