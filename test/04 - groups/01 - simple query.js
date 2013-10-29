var assert = require('chai').assert;
var myJson = require('../../main');

describe('Class groups', function () {
	it('define MyJSON class groups', function () {
		var classes = myJson.group({
			TestClass: {
				table: 'TestTable',
				columns: {
					'integer/id': 'id',
					'string/name': 'name'
				}
			},
			TestClass2: {
				table: 'TestTable2',
				columns: {
					'integer/id': 'id',
					'string/name': 'name'
				}
			}
		});
		
		assert.isFunction(classes.TestClass);
		assert.isFunction(classes.TestClass2);
		assert.notEqual(classes.TestClass, classes.TestClass2);
	});
});
